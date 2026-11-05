# Rails 8.1.4.1 upgrade review

Reviewed November 5, 2026. This change is held for Claude's release decision. It changes dependency constraints, lockfiles, specs and this review only. Payroll calculations, source mappings, approval/commit, connected-mode guards and database migrations are unchanged. Full CI and an updated exact-pair integration certificate remain release gates.

## Dependency boundary

The 13 Rails/framework gems move from 8.1.3.1 to 8.1.4.1: Rails, Railties, Active Support, Active Model, Active Record, Active Job, Active Storage, Action Pack, Action View, Action Mailer, Action Mailbox, Action Cable and Action Text. All other gem versions and platforms are unchanged, including Rack 3.2.8, Nokogiri 1.19.7, rails-html-sanitizer 1.7.2, Loofah 2.25.3, MiniMagick 5.3.1 and ruby-vips 2.3.0. The new Action View sanitizer requirement is already satisfied. No unrelated updates or advisory exclusions were added.

## Behavior review

Read the [8.1.4](https://github.com/rails/rails/releases/tag/v8.1.4) and [8.1.4.1](https://github.com/rails/rails/releases/tag/v8.1.4.1) release notes and framework changes. Findings relevant to these apps:

| Area | Finding and acceptance |
| --- | --- |
| Forwarded client IP | When both header families are supplied, different resolved client addresses now raise `ActionDispatch::RemoteIp::IpSpoofAttackError`. Local requests with X-Forwarded-For alone or matching headers reach the real API. A conflict raises even in request logging, outside the inner exception handler; its default exception status is 500. This needs the hosted check below. |
| Parameters | `each_key` now returns the parameters object. App call-site searches found Hash iteration, with no use of a returned unpermitted parameter object for assignment. New specs verify the returned object remains unpermitted and assignment raises. |
| Sessions | Cookie SameSite settings now apply across stores; CacheStore has dropped-session and reset/concurrency fixes. Both apps use API token authentication and load no Rails session middleware in the tested configuration. `Rails.cache` and Rack::Attack caching are separate from `Session::CacheStore`. No session configuration changed. |
| Storage | Blob tempfiles retain an extension only when it agrees with the recorded media type; sanitized filename handling also changes. Video/audio probing now limits accepted container formats, and background video preview handling improves. Common image/video uploads need hosted checks. Neither app uses GCS, so its new signed content-length/CORS requirements are inactive here. |
| ImageMagick | Rails installs a policy through `MiniMagick.cli_env` for every MiniMagick invocation, even when Active Storage uses vips. PDF/PostScript coders and Ghostscript are restricted unless the host policy explicitly permits them. MiniMagick below 5.1 with the MiniMagick variant processor now fails boot; the locked version is 5.3.1 and both apps booted. Do not disable the policy globally. |
| View helpers | `strip_tags` now encodes quotes; tag helpers discard blank attribute names; highlight substitutions escape matches; sanitizer dependency bounds tighten. No app calls to `strip_tags`, `highlight` or `simple_format` were found. Do not decode HTML indiscriminately. ERB mail previews still need a hosted check. |
| Record/query behavior | Schema defaults now preserve their database representation; grouped aggregate/write, callback-ordering and connection-pool fixes may affect callers. Searches found no consumers of deserialized column defaults or the changed distinct/callback forms. Focused app checks passed; full CI is still required. |
| Other behavior | Fractional duration conversions now preserve subsecond precision; the found app conversion uses a whole-day constant. No new general deprecation-to-error switch was identified. Existing RSpec/Rack deprecated status warnings still warn. MessagePack's safe-string encoding changes matter to mixed-version readers if that optional serializer is configured; no explicit MessagePack serializer was found. |

Sources: [Action Pack](https://github.com/rails/rails/blob/v8.1.4.1/actionpack/CHANGELOG.md), [Active Storage](https://github.com/rails/rails/blob/v8.1.4.1/activestorage/CHANGELOG.md), [Action View](https://github.com/rails/rails/blob/v8.1.4.1/actionview/CHANGELOG.md), [Active Record](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/CHANGELOG.md), [Active Support](https://github.com/rails/rails/blob/v8.1.4.1/activesupport/CHANGELOG.md).

## Hosted IP gate and safe configuration

[Render describes its Cloudflare/load-balancer chain and X-Forwarded-For](https://render.com/articles/how-render-handles-ddos-attacks), but does not establish how client-supplied `Forwarded` is normalized. Normal Render traffic triggering the new exception is therefore unverified. Rack's request IP is also distinct from Rails `remote_ip`: Rack currently prefers Forwarded, so throttling and audits must agree after ingress processing.

On candidate staging, the release owner should inspect sanitized forwarding headers and socket IP for an ordinary browser/API request, matching headers, and deliberately conflicting TEST-NET addresses. Use a real controller endpoint, not only `/up`; logging level can change where lazy IP evaluation happens. Confirm the authenticated audit IP and Rack::Attack key resolve to the same client, and no legitimate request becomes a 500. Do not log credentials or complete authenticated request headers.

Keep spoof checking enabled. Trust only the verified proxy-hop CIDRs, never every address. If Render preserves a client-controlled Forwarded header while supplying authoritative X-Forwarded-For, the concrete safe ingress setup is to strip Forwarded at the verified trusted edge, retain that edge's canonical X-Forwarded-For chain, and make both Rails and Rack::Attack consume that chain. If ingress normalization is unavailable, a narrowly scoped outer middleware can reject `IpSpoofAttackError` with 400 before Rails logging and IP consumers. A controller rescue or `rescue_responses` entry alone is insufficient for the observed logging failure. Either mitigation needs its own tested configuration change; neither is silently applied by this dependency PR. Retest normal traffic, spoof rejection, audit IPs and throttling before promotion.

## Local evidence and remaining hosted checks

Base: `8338e759850a2f4b3f5d5c6358e9bdfd435d0c1b`.

- 24 focused examples passed, covering forwarding/parameters, Rack::Attack, site-media admin/public APIs, team-member photo APIs, real vips PNG analysis/variant processing, and unsafe-extension tempfile handling. New-spec RuboCop passed. Updated `bin/bundler-audit` reports no vulnerabilities.
- AIRE uses Rails' default trusted proxies; no app-specific proxy list was found. Rack::Attack consumes Rack request IP while controller audit context consumes Rails `remote_ip`. Verify both identities on Render rather than assuming they are interchangeable.
- SiteMedia file/poster and User public-team-photo attachments use Active Storage. PNG tests perform real vips work. The shared Mac has a pre-existing missing HEIF native dependency, so HEIF analysis was not validated. Hosted acceptance should upload/display an ordinary team photo and site poster, analyze/preview existing MP4/WebM/QuickTime media, and verify downloads. Test any required uncommon format before adding it narrowly to `ffmpeg_allowed_formats`.
- The GCS and mirror changes do not match the configured storage services. The local test bundle needed a task-owned native-gem overlay because the shared Ruby installation contained extensions built against a different Ruby; no lock versions changed to work around that environment issue.
- Run the hosted IP gate, token-auth/audit/throttle smoke, mail previews and updated exact-pair payroll certificate before release. Full CI must cover existing connected-mode and paused behavior. No hosted requests or writes were made for this review.
