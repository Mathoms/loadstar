# Third-Party Components

Loadstar itself is licensed under **Apache License 2.0** (see `LICENSE`).

To do its job, Loadstar downloads and runs several independent open-source
tools. These are **not** part of this repository and are **not** redistributed
in source form here — they are fetched at build time from their official
sources and invoked by Loadstar as separate programs. Each retains its own
license, listed below.

This file is a good-faith disclosure of what Loadstar uses and how. It is not
legal advice and does not constitute a compliance certification. If you intend
to offer Loadstar as a hosted/network service or otherwise redistribute it,
review the obligations of each component below — in particular k6's AGPL-3.0
license — with qualified counsel.

## Load & browser engines

| Component | Version | License | How Loadstar uses it |
|-----------|---------|---------|----------------------|
| [Apache JMeter](https://jmeter.apache.org/) | 5.6.3 | Apache-2.0 | Downloaded from the Apache archive at image build; invoked as a separate subprocess. Unmodified. |
| [Grafana k6](https://github.com/grafana/k6) | 0.53.0 | **AGPL-3.0** | Official release binary downloaded from GitHub at image build; invoked as a separate subprocess. **Unmodified. Not linked. Source not included.** |
| [Playwright](https://github.com/microsoft/playwright) | 1.47.0 | Apache-2.0 | Node.js dependency; used to drive browser tests. |
| Browser engines (Chromium, Firefox, WebKit) | via mcr.microsoft.com/playwright:v1.47.0-jammy | BSD-3-Clause / MPL-2.0 / LGPL (respective) | Preinstalled in Microsoft's Playwright base image, used by Playwright for browser automation. |

## A note on k6 and AGPL-3.0

k6 is licensed under the **GNU Affero General Public License v3.0**. Grafana
Labs relicensed k6 (and its other core projects) from Apache-2.0 to AGPL-3.0 in
April 2021.

Loadstar's relationship to k6 is deliberately arm's-length:

- Loadstar **downloads the official, unmodified k6 release binary** at container
  build time. It is not committed to this repository.
- Loadstar **invokes k6 as a separate subprocess** (spawn) and communicates
  with it over standard input/output. It does not modify k6, link against it, or
  incorporate its source.
- The k6 scripts Loadstar generates (which import from k6/http etc.) are
  produced at runtime and executed by the k6 binary; Loadstar's own source and
  those generated scripts are separate works, licensed Apache-2.0.

Under this arrangement, AGPL-3.0 Section 13 (the "remote network interaction"
clause) is conditioned on *modifying* k6, which Loadstar does not do. **However**,
whether offering k6 execution as part of a hosted network service creates
additional obligations is a question that depends on specifics and jurisdiction.
If you plan to run Loadstar as a commercial/hosted service, get a licensing
attorney's opinion first. Grafana also offers commercial k6 licensing for teams
that need to avoid AGPL obligations.

If you redistribute a pre-built Loadstar image that contains the k6 binary, note
that you are then conveying k6 and must comply with AGPL-3.0's terms for that
binary (including making its license available and, for an unmodified binary,
pointing recipients to the official source at
https://github.com/grafana/k6).

## AI analysis (Anthropic Claude)

Loadstar's AI analysis calls the Anthropic API using **an API key that you
supply**. Loadstar does not bundle, redistribute, or proxy Anthropic's models,
and no Anthropic software is included in this repository. Your use of the
Anthropic API is governed by your own agreement with Anthropic.

## Trademarks

"BlazeMeter" is a trademark of Perforce Software, Inc. Any reference to it in
Loadstar's documentation is descriptive (nominative) only and does not imply
affiliation or endorsement. "Grafana" and "k6" are trademarks of Grafana Labs;
"Apache", "JMeter", and the Apache feather are trademarks of the Apache Software
Foundation. These names are used only to identify the respective software.
