StudyDeck vendors the published `next-auth` 5.0.0-beta.32 runtime under the
local package name `@studydeck/auth`. The upstream code is ISC licensed; its
LICENSE file is retained unchanged.

The optional Nodemailer peer dependency is intentionally removed from this
package manifest. StudyDeck configures only Telegram OAuth and does not use an
email provider. This keeps an unused, vulnerable email transport out of the
production dependency graph while preserving the upstream runtime and API used
by the application.
