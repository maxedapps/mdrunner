use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use percent_encoding::percent_decode_str;
use ureq::ResponseExt as _;
use ureq::config::RedirectAuthHeaders;
use url::Url;

use crate::AppError;
use crate::source::{BoundedReadError, MAX_SOURCE_BYTES, read_bounded_bytes, redacted_url};

pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const GLOBAL_TIMEOUT: Duration = Duration::from_secs(20);
pub(crate) const MAX_REDIRECTS: u32 = 10;

const USER_AGENT: &str = concat!("mdr/", env!("CARGO_PKG_VERSION"));

#[derive(Debug)]
pub(crate) struct RemoteDocument {
    pub(crate) markdown: String,
    pub(crate) final_url: Url,
}

pub(crate) trait RemoteFetcher {
    fn fetch(&self, requested_url: &Url) -> Result<RemoteDocument, AppError>;
}

pub(crate) struct SystemRemoteFetcher {
    agent: ureq::Agent,
}

impl SystemRemoteFetcher {
    pub(crate) fn new() -> Self {
        Self {
            agent: build_agent(CONNECT_TIMEOUT, GLOBAL_TIMEOUT, MAX_REDIRECTS),
        }
    }

    #[cfg(test)]
    fn with_timeouts(connect: Duration, global: Duration) -> Self {
        Self {
            agent: build_agent(connect, global, MAX_REDIRECTS),
        }
    }
}

impl RemoteFetcher for SystemRemoteFetcher {
    fn fetch(&self, requested_url: &Url) -> Result<RemoteDocument, AppError> {
        fetch_with_agent(&self.agent, requested_url)
            .map_err(|error| AppError::labeled(error.message(), redacted_url(requested_url)))
    }
}

fn build_agent(connect: Duration, global: Duration, max_redirects: u32) -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .proxy(None)
        .timeout_connect(Some(connect))
        .timeout_global(Some(global))
        .max_redirects(max_redirects)
        .max_redirects_will_error(true)
        .redirect_auth_headers(RedirectAuthHeaders::Never)
        .user_agent(USER_AGENT)
        .build();
    ureq::Agent::new_with_config(config)
}

fn fetch_with_agent(
    agent: &ureq::Agent,
    requested_url: &Url,
) -> Result<RemoteDocument, RemoteError> {
    validate_remote_url(requested_url)?;
    let mut request_url = normalize_github_blob_url(requested_url);
    request_url.set_fragment(None);
    let global_timeout = agent.config().timeouts().global.unwrap_or(GLOBAL_TIMEOUT);
    let deadline = Instant::now() + global_timeout;
    let mut redirects_followed = 0;

    let mut response = loop {
        validate_remote_url(&request_url)?;
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or(RemoteError::Timeout)?;
        let request = agent
            .get(request_url.as_str())
            .config()
            .timeout_global(Some(remaining))
            .max_redirects(0)
            .max_redirects_will_error(false)
            .build();
        let request = if let Some(authorization) = basic_authorization(&request_url)? {
            request.header(ureq::http::header::AUTHORIZATION, authorization)
        } else {
            request
        };
        let response = request.call().map_err(RemoteError::from_ureq)?;

        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            if redirects_followed >= MAX_REDIRECTS {
                return Err(RemoteError::TooManyRedirects);
            }
            let location = response
                .headers()
                .get(ureq::http::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or(RemoteError::InvalidRedirect)?;
            request_url = redirected_url(&request_url, location)?;
            redirects_followed += 1;
            continue;
        }
        break response;
    };

    if !response.status().is_success() {
        return Err(RemoteError::Status(response.status().as_u16()));
    }

    let final_url = Url::parse(response.get_uri().to_string().as_str())
        .map_err(|_| RemoteError::UnsafeFinalUrl)?;
    validate_remote_url(&final_url).map_err(|_| RemoteError::UnsafeFinalUrl)?;

    validate_content_type(
        response.headers().get(ureq::http::header::CONTENT_TYPE),
        requested_url,
        &final_url,
    )?;
    validate_content_length(response.headers().get(ureq::http::header::CONTENT_LENGTH))?;

    let bytes = match read_bounded_bytes(response.body_mut().as_reader()) {
        Ok(bytes) => bytes,
        Err(BoundedReadError::TooLarge) => return Err(RemoteError::TooLarge),
        Err(BoundedReadError::Read(error)) => {
            return Err(RemoteError::from_ureq(ureq::Error::from(error)));
        }
    };
    let markdown = String::from_utf8(bytes).map_err(|_| RemoteError::InvalidUtf8)?;
    if markdown.trim().is_empty() {
        return Err(RemoteError::Empty);
    }

    Ok(RemoteDocument {
        markdown,
        final_url,
    })
}

fn validate_remote_url(url: &Url) -> Result<(), RemoteError> {
    if matches!(url.scheme(), "http" | "https") && url.host_str().is_some() {
        Ok(())
    } else {
        Err(RemoteError::InvalidUrl)
    }
}

fn redirected_url(current: &Url, location: &str) -> Result<Url, RemoteError> {
    let supplies_credentials = redirect_supplies_credentials(location);
    let mut redirected = current
        .join(location)
        .map_err(|_| RemoteError::InvalidRedirect)?;
    if !supplies_credentials {
        let _ = redirected.set_password(None);
        let _ = redirected.set_username("");
    }
    redirected.set_fragment(None);
    validate_remote_url(&redirected).map_err(|_| RemoteError::InvalidRedirect)?;
    Ok(redirected)
}

fn redirect_supplies_credentials(location: &str) -> bool {
    Url::parse(location)
        .ok()
        .or_else(|| {
            location
                .starts_with("//")
                .then(|| Url::parse(&format!("http:{location}")).ok())
                .flatten()
        })
        .is_some_and(|url| !url.username().is_empty() || url.password().is_some())
}

fn basic_authorization(url: &Url) -> Result<Option<String>, RemoteError> {
    if url.username().is_empty() && url.password().is_none() {
        return Ok(None);
    }
    let username = percent_decode_str(url.username())
        .decode_utf8()
        .map_err(|_| RemoteError::InvalidCredentials)?;
    let password = percent_decode_str(url.password().unwrap_or_default())
        .decode_utf8()
        .map_err(|_| RemoteError::InvalidCredentials)?;
    Ok(Some(format!(
        "Basic {}",
        STANDARD.encode(format!("{username}:{password}"))
    )))
}

fn validate_content_length(value: Option<&ureq::http::HeaderValue>) -> Result<(), RemoteError> {
    let Some(value) = value else {
        return Ok(());
    };
    let length = value
        .to_str()
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or(RemoteError::InvalidMetadata)?;
    if length > MAX_SOURCE_BYTES {
        Err(RemoteError::TooLarge)
    } else {
        Ok(())
    }
}

fn validate_content_type(
    value: Option<&ureq::http::HeaderValue>,
    requested_url: &Url,
    final_url: &Url,
) -> Result<(), RemoteError> {
    let extension_allows_generic =
        has_markdown_url_extension(requested_url) || has_markdown_url_extension(final_url);
    let Some(value) = value else {
        return extension_allows_generic
            .then_some(())
            .ok_or(RemoteError::UnsupportedContentType);
    };
    let value = value
        .to_str()
        .map_err(|_| RemoteError::MalformedContentType)?;
    let media_type = value
        .split_once(';')
        .map_or(value, |(token, _)| token)
        .trim();
    if !valid_media_type_token(media_type) {
        return Err(RemoteError::MalformedContentType);
    }
    if ["text/markdown", "text/plain", "application/markdown"]
        .iter()
        .any(|accepted| media_type.eq_ignore_ascii_case(accepted))
    {
        return Ok(());
    }
    if media_type.eq_ignore_ascii_case("application/octet-stream") && extension_allows_generic {
        return Ok(());
    }
    Err(RemoteError::UnsupportedContentType)
}

fn valid_media_type_token(value: &str) -> bool {
    let Some((kind, subtype)) = value.split_once('/') else {
        return false;
    };
    !kind.is_empty()
        && !subtype.is_empty()
        && !subtype.contains('/')
        && kind.bytes().all(is_mime_token_byte)
        && subtype.bytes().all(is_mime_token_byte)
}

fn is_mime_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
}

fn has_markdown_url_extension(url: &Url) -> bool {
    let path = url.path().to_ascii_lowercase();
    [".md", ".mdx", ".markdown"]
        .iter()
        .any(|extension| path.ends_with(extension))
}

pub(crate) fn normalize_github_blob_url(url: &Url) -> Url {
    if !matches!(url.scheme(), "http" | "https")
        || !url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case("github.com"))
        || url.port().is_some()
    {
        return url.clone();
    }
    let Some(segments) = url.path_segments().map(Iterator::collect::<Vec<_>>) else {
        return url.clone();
    };
    if segments.len() < 4
        || segments[0].is_empty()
        || segments[1].is_empty()
        || segments[2] != "blob"
        || segments[3].is_empty()
    {
        return url.clone();
    }

    let mut normalized = url.clone();
    let path = url.path();
    let prefix_len = segments[0].len() + segments[1].len() + "/".len() * 3;
    let blob_start = prefix_len;
    let blob_end = blob_start + "blob".len();
    debug_assert_eq!(&path[blob_start..blob_end], "blob");
    let rewritten = format!("{}raw{}", &path[..blob_start], &path[blob_end..]);
    normalized.set_path(&rewritten);
    normalized
}

#[derive(Debug)]
enum RemoteError {
    InvalidUrl,
    InvalidCredentials,
    Status(u16),
    Timeout,
    Tls,
    Transport,
    Decompression,
    TooManyRedirects,
    TooLarge,
    InvalidUtf8,
    Empty,
    MalformedContentType,
    UnsupportedContentType,
    InvalidMetadata,
    InvalidRedirect,
    UnsafeFinalUrl,
}

impl RemoteError {
    fn from_ureq(error: ureq::Error) -> Self {
        match error {
            ureq::Error::StatusCode(status) => Self::Status(status),
            ureq::Error::Timeout(_) => Self::Timeout,
            ureq::Error::Tls(_) | ureq::Error::Rustls(_) | ureq::Error::TlsRequired => Self::Tls,
            ureq::Error::TooManyRedirects => Self::TooManyRedirects,
            ureq::Error::Decompress(_, _) => Self::Decompression,
            _ => Self::Transport,
        }
    }

    fn message(&self) -> String {
        match self {
            Self::InvalidUrl => "Expected an absolute HTTP(S) URL.".to_owned(),
            Self::InvalidCredentials => "URL credentials are not valid UTF-8.".to_owned(),
            Self::Status(status) => format!("Remote server returned HTTP {status}."),
            Self::Timeout => "Remote request timed out.".to_owned(),
            Self::Tls => "Remote TLS connection failed.".to_owned(),
            Self::Transport => "Remote request failed.".to_owned(),
            Self::Decompression => "Remote response decompression failed.".to_owned(),
            Self::TooManyRedirects => "Remote request exceeded 10 redirects.".to_owned(),
            Self::TooLarge => "Input exceeds the 10 MiB limit.".to_owned(),
            Self::InvalidUtf8 => "Input is not valid UTF-8.".to_owned(),
            Self::Empty => "Remote Markdown is empty.".to_owned(),
            Self::MalformedContentType => "Remote Content-Type is malformed.".to_owned(),
            Self::UnsupportedContentType => {
                "Remote Content-Type is not Markdown or plain text.".to_owned()
            }
            Self::InvalidMetadata => "Remote response metadata is invalid.".to_owned(),
            Self::InvalidRedirect => "Remote redirect URL is invalid.".to_owned(),
            Self::UnsafeFinalUrl => "Remote response has an unsafe final URL.".to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc::{self, Receiver};
    use std::thread::{self, JoinHandle};
    use std::time::{Duration, Instant};

    use flate2::Compression;
    use flate2::write::GzEncoder;
    use ureq::http::HeaderValue;

    use super::*;

    fn response(status: &str, headers: &[(&str, String)], body: &[u8]) -> Vec<u8> {
        let mut bytes = format!("HTTP/1.1 {status}\r\nConnection: close\r\n").into_bytes();
        for (name, value) in headers {
            bytes.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
        }
        bytes.extend_from_slice(b"\r\n");
        bytes.extend_from_slice(body);
        bytes
    }

    fn read_request(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 2048];
        while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            let count = stream.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        String::from_utf8(bytes).unwrap()
    }

    fn server(
        request_count: usize,
        handler: impl Fn(usize, &str, u16) -> Vec<u8> + Send + 'static,
    ) -> (Url, Receiver<String>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, receiver) = mpsc::channel();
        let join = thread::spawn(move || {
            for index in 0..request_count {
                let deadline = Instant::now() + Duration::from_secs(5);
                let (mut stream, _) = loop {
                    match listener.accept() {
                        Ok(connection) => break connection,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "loopback request did not arrive");
                            thread::sleep(Duration::from_millis(2));
                        }
                        Err(error) => panic!("loopback accept failed: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                let request = read_request(&mut stream);
                let _ = sender.send(request.clone());
                let reply = handler(index, &request, port);
                if !reply.is_empty() {
                    stream.write_all(&reply).unwrap();
                }
            }
        });
        (
            Url::parse(&format!("http://127.0.0.1:{port}/document.md")).unwrap(),
            receiver,
            join,
        )
    }

    fn fetch(url: &Url) -> Result<RemoteDocument, AppError> {
        SystemRemoteFetcher::with_timeouts(Duration::from_millis(100), Duration::from_secs(10))
            .fetch(url)
    }

    fn authorization(request: &str) -> Option<&str> {
        request.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("authorization")
                .then(|| value.trim())
        })
    }

    #[test]
    fn production_agent_is_direct_versioned_and_bounded() {
        let fetcher = SystemRemoteFetcher::new();
        let config = fetcher.agent.config();
        assert!(config.proxy().is_none());
        assert_eq!(config.timeouts().connect, Some(CONNECT_TIMEOUT));
        assert_eq!(config.timeouts().global, Some(GLOBAL_TIMEOUT));
        assert_eq!(config.max_redirects(), MAX_REDIRECTS);
        assert!(config.max_redirects_will_error());
        assert_eq!(config.redirect_auth_headers(), RedirectAuthHeaders::Never);
        assert!(format!("{:?}", config.user_agent()).contains(USER_AGENT));
    }

    #[test]
    fn redirect_mapping_allows_cross_scheme_and_clears_inherited_credentials() {
        let current = Url::parse("http://user:secret@example.test/start.md").unwrap();
        assert_eq!(
            redirected_url(&current, "https://secure.test/final.md")
                .unwrap()
                .as_str(),
            "https://secure.test/final.md"
        );
        let secure = Url::parse("https://user:secret@example.test/start.md").unwrap();
        assert_eq!(
            redirected_url(&secure, "http://plain.test/final.md")
                .unwrap()
                .as_str(),
            "http://plain.test/final.md"
        );
        assert_eq!(
            redirected_url(&current, "/relative.md").unwrap().as_str(),
            "http://example.test/relative.md"
        );
        assert_eq!(
            redirected_url(&current, "//next:p%40ss@other.test/final.md")
                .unwrap()
                .as_str(),
            "http://next:p%40ss@other.test/final.md"
        );
        assert!(redirected_url(&current, "file:///tmp/local.md").is_err());
    }

    #[test]
    fn github_normalization_is_canonical_and_preserves_opaque_url_parts() {
        let cases = [
            (
                "https://github.com/o/r/blob/main/README.md",
                "https://github.com/o/r/raw/main/README.md",
            ),
            (
                "http://user:pass@github.com/o/r/blob/feature/docs/guide.md?q=1#part",
                "http://user:pass@github.com/o/r/raw/feature/docs/guide.md?q=1#part",
            ),
            (
                "https://github.com/o/r/blob/0123456789abcdef/Unicode%20%C3%BC.md?raw=1",
                "https://github.com/o/r/raw/0123456789abcdef/Unicode%20%C3%BC.md?raw=1",
            ),
            (
                "https://github.com/o/r/blob/feature%2Fdocs/file.md",
                "https://github.com/o/r/raw/feature%2Fdocs/file.md",
            ),
            (
                "https://github.com/o/r/blob/main",
                "https://github.com/o/r/raw/main",
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(
                normalize_github_blob_url(&Url::parse(input).unwrap()).as_str(),
                expected
            );
        }

        for unchanged in [
            "https://example.com/o/r/blob/main/a.md",
            "https://github.com/o/r/raw/main/a.md",
            "https://github.com/o/r/blob/",
            "https://github.com:8443/o/r/blob/main/a.md",
            "https://github.com/o//blob/main/a.md",
            "https://api.github.com/o/r/blob/main/a.md",
            "ftp://github.com/o/r/blob/main/a.md",
        ] {
            let url = Url::parse(unchanged).unwrap();
            assert_eq!(normalize_github_blob_url(&url), url, "{unchanged}");
        }
    }

    #[test]
    fn mime_contract_is_exact_case_insensitive_and_extension_gated() {
        let md = Url::parse("https://example.test/readme.MDX").unwrap();
        let no_extension = Url::parse("https://example.test/document").unwrap();
        for accepted in [
            "text/markdown",
            "TEXT/PLAIN; Charset=UTF-8",
            "application/markdown ; profile=x",
        ] {
            let header = HeaderValue::from_str(accepted).unwrap();
            assert!(validate_content_type(Some(&header), &no_extension, &no_extension).is_ok());
        }
        for generic in [None, Some("application/octet-stream")] {
            let header = generic.map(|value| HeaderValue::from_str(value).unwrap());
            assert!(validate_content_type(header.as_ref(), &md, &no_extension).is_ok());
            assert!(validate_content_type(header.as_ref(), &no_extension, &md).is_ok());
            assert!(matches!(
                validate_content_type(header.as_ref(), &no_extension, &no_extension),
                Err(RemoteError::UnsupportedContentType)
            ));
        }
        for unsupported in [
            "text/html",
            "application/xhtml+xml",
            "image/png",
            "text/plainish",
        ] {
            let header = HeaderValue::from_str(unsupported).unwrap();
            assert!(matches!(
                validate_content_type(Some(&header), &md, &md),
                Err(RemoteError::UnsupportedContentType)
            ));
        }
        for malformed in ["", "plain", "text/", "text /plain", "text/plain/extra"] {
            let header = HeaderValue::from_str(malformed).unwrap();
            assert!(matches!(
                validate_content_type(Some(&header), &md, &md),
                Err(RemoteError::MalformedContentType)
            ));
        }
        let non_ascii = HeaderValue::from_bytes(&[0xff]).unwrap();
        assert!(matches!(
            validate_content_type(Some(&non_ascii), &md, &md),
            Err(RemoteError::MalformedContentType)
        ));
    }

    #[test]
    fn loopback_enforces_real_response_mime_variants() {
        let cases = [
            (Some("TEXT/PLAIN; Charset=UTF-8"), "/document", true),
            (Some("application/markdown"), "/document", true),
            (Some("application/octet-stream"), "/document.md", true),
            (None, "/document.MARKDOWN", true),
            (Some("application/octet-stream"), "/document", false),
            (None, "/document", false),
            (Some("text/html"), "/document.md", false),
            (Some("application/xhtml+xml"), "/document.md", false),
            (Some("text /plain"), "/document.md", false),
            (Some("image/png"), "/document.md", false),
        ];
        for (content_type, path, succeeds) in cases {
            let fixture = server(1, move |_, _, _| {
                let headers = content_type
                    .map(|value| vec![("Content-Type", value.to_owned())])
                    .unwrap_or_default();
                response("200 OK", &headers, b"# document")
            });
            let mut url = fixture.0.clone();
            url.set_path(path);
            let result = fetch(&url);
            assert_eq!(
                result.is_ok(),
                succeeds,
                "{content_type:?} {path}: {result:?}"
            );
            fixture.2.join().unwrap();
        }
    }

    #[test]
    fn loopback_fetch_accepts_exact_decoded_limit_and_final_redirect_uri() {
        let exact = vec![b'x'; MAX_SOURCE_BYTES as usize];
        let (url, _, join) = server(2, move |index, _, port| {
            if index == 0 {
                response(
                    "302 Found",
                    &[(
                        "Location",
                        format!("http://127.0.0.1:{port}/final.MARKDOWN?q=1"),
                    )],
                    b"ignored body",
                )
            } else {
                response(
                    "200 OK",
                    &[
                        ("Content-Type", "application/octet-stream".to_owned()),
                        ("Content-Length", MAX_SOURCE_BYTES.to_string()),
                    ],
                    &exact,
                )
            }
        });
        let document = fetch(&url).unwrap();
        assert_eq!(document.markdown.len() as u64, MAX_SOURCE_BYTES);
        assert!(document.final_url.as_str().ends_with("/final.MARKDOWN?q=1"));
        join.join().unwrap();
    }

    #[test]
    fn loopback_rejects_declared_chunked_and_gzip_decoded_oversize() {
        let declared = server(1, |_, _, _| {
            response(
                "200 OK",
                &[
                    ("Content-Type", "text/plain".to_owned()),
                    ("Content-Length", (MAX_SOURCE_BYTES + 1).to_string()),
                ],
                b"",
            )
        });
        assert!(
            fetch(&declared.0)
                .unwrap_err()
                .to_string()
                .contains("10 MiB")
        );
        declared.2.join().unwrap();

        let chunk = vec![b'x'; MAX_SOURCE_BYTES as usize + 1];
        let chunked = server(1, move |_, _, _| {
            let mut reply = response(
                "200 OK",
                &[
                    ("Content-Type", "text/plain".to_owned()),
                    ("Transfer-Encoding", "chunked".to_owned()),
                ],
                b"",
            );
            reply.extend_from_slice(format!("{:x}\r\n", chunk.len()).as_bytes());
            reply.extend_from_slice(&chunk);
            reply.extend_from_slice(b"\r\n0\r\n\r\n");
            reply
        });
        assert!(
            fetch(&chunked.0)
                .unwrap_err()
                .to_string()
                .contains("10 MiB")
        );
        chunked.2.join().unwrap();

        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
        encoder
            .write_all(&vec![b'x'; MAX_SOURCE_BYTES as usize + 1])
            .unwrap();
        let compressed = encoder.finish().unwrap();
        assert!(compressed.len() < MAX_SOURCE_BYTES as usize);
        let gzip = server(1, move |_, _, _| {
            response(
                "200 OK",
                &[
                    ("Content-Type", "text/plain".to_owned()),
                    ("Content-Encoding", "gzip".to_owned()),
                    ("Content-Length", compressed.len().to_string()),
                ],
                &compressed,
            )
        });
        assert!(fetch(&gzip.0).unwrap_err().to_string().contains("10 MiB"));
        gzip.2.join().unwrap();
    }

    #[test]
    fn loopback_maps_status_timeout_redirects_utf8_empty_and_decompression() {
        let status = server(1, |_, _, _| {
            response(
                "404 Not Found",
                &[("Content-Type", "text/plain".to_owned())],
                b"secret response body",
            )
        });
        let error = fetch(&status.0).unwrap_err().to_string();
        assert!(error.contains("HTTP 404"));
        assert!(!error.contains("secret"));
        status.2.join().unwrap();

        let timeout = server(1, |_, _, _| {
            thread::sleep(Duration::from_millis(200));
            Vec::new()
        });
        let error = SystemRemoteFetcher::with_timeouts(
            Duration::from_millis(50),
            Duration::from_millis(50),
        )
        .fetch(&timeout.0)
        .unwrap_err()
        .to_string();
        assert!(error.contains("timed out"), "{error}");
        timeout.2.join().unwrap();

        let redirects = server(11, |_, _, port| {
            response(
                "302 Found",
                &[("Location", format!("http://127.0.0.1:{port}/again.md"))],
                b"",
            )
        });
        let started = Instant::now();
        let error = fetch(&redirects.0).unwrap_err().to_string();
        assert!(error.contains("10 redirects"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(2));
        redirects.2.join().unwrap();

        for (body, expected) in [(&[0xff][..], "valid UTF-8"), (b" \n\t", "empty")] {
            let bytes = body.to_vec();
            let fixture = server(1, move |_, _, _| {
                response(
                    "200 OK",
                    &[("Content-Type", "text/plain".to_owned())],
                    &bytes,
                )
            });
            let error = fetch(&fixture.0).unwrap_err().to_string();
            assert!(error.contains(expected), "{error}");
            fixture.2.join().unwrap();
        }

        let invalid_gzip = server(1, |_, _, _| {
            response(
                "200 OK",
                &[
                    ("Content-Type", "text/plain".to_owned()),
                    ("Content-Encoding", "gzip".to_owned()),
                ],
                b"not gzip",
            )
        });
        let error = fetch(&invalid_gzip.0).unwrap_err().to_string();
        assert!(error.contains("decompression"), "{error}");
        invalid_gzip.2.join().unwrap();
    }

    #[test]
    fn loopback_basic_auth_is_decoded_initially_and_never_forwarded() {
        let fixture = server(2, |index, _, _| {
            if index == 0 {
                response("302 Found", &[("Location", "/final.md".to_owned())], b"")
            } else {
                response(
                    "200 OK",
                    &[("Content-Type", "text/plain".to_owned())],
                    b"# final",
                )
            }
        });
        let credentialed = Url::parse(&fixture.0.as_str().replacen(
            "http://",
            "http://user%20name:p%40ss@",
            1,
        ))
        .unwrap();
        let document = fetch(&credentialed).unwrap();
        assert_eq!(document.markdown, "# final");
        let initial = fixture.1.recv().unwrap();
        let redirected = fixture.1.recv().unwrap();
        assert_eq!(
            authorization(&initial),
            Some(format!("Basic {}", STANDARD.encode("user name:p@ss")).as_str())
        );
        assert_eq!(authorization(&redirected), None);
        fixture.2.join().unwrap();
    }

    #[test]
    fn redirect_target_credentials_replace_initial_credentials_and_are_decoded() {
        let fixture = server(2, |index, _, port| {
            if index == 0 {
                response(
                    "302 Found",
                    &[(
                        "Location",
                        format!("http://target%20user:p%40ss@127.0.0.1:{port}/final.md"),
                    )],
                    b"",
                )
            } else {
                response(
                    "200 OK",
                    &[("Content-Type", "text/plain".to_owned())],
                    b"# final",
                )
            }
        });
        let mut initial_url = fixture.0.clone();
        initial_url.set_username("initial").unwrap();
        initial_url.set_password(Some("private")).unwrap();
        fetch(&initial_url).unwrap();
        let initial = fixture.1.recv().unwrap();
        let target = fixture.1.recv().unwrap();
        assert_eq!(
            authorization(&initial),
            Some(format!("Basic {}", STANDARD.encode("initial:private")).as_str())
        );
        assert_eq!(
            authorization(&target),
            Some(format!("Basic {}", STANDARD.encode("target user:p@ss")).as_str())
        );
        fixture.2.join().unwrap();
    }

    #[test]
    fn errors_are_fully_redacted_and_transport_classes_are_concise() {
        let fixture = server(1, |_, _, _| {
            response(
                "500 Internal Server Error",
                &[("Content-Type", "text/plain".to_owned())],
                b"password secret body",
            )
        });
        let mut url = fixture.0.clone();
        url.set_username("visible-user").unwrap();
        url.set_password(Some("visible-password")).unwrap();
        let error = fetch(&url).unwrap_err().to_string();
        for secret in ["visible-user", "visible-password", "secret body"] {
            assert!(!error.contains(secret), "{error}");
        }
        assert!(error.starts_with("http://127.0.0.1:"));
        fixture.2.join().unwrap();

        assert!(matches!(
            RemoteError::from_ureq(ureq::Error::Tls("handshake")),
            RemoteError::Tls
        ));
        assert!(matches!(
            RemoteError::from_ureq(ureq::Error::ConnectionFailed),
            RemoteError::Transport
        ));
    }
}
