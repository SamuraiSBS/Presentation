StudyDeck vendors the published `@auth/core` 0.41.3 runtime. The upstream code
is ISC licensed; its LICENSE file is retained unchanged.

The optional Nodemailer peer dependency is removed from the local package
manifest. The application configures Telegram OAuth only and never loads an
email provider, so the email transport is not part of its production runtime.
