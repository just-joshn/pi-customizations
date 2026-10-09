# Notes

Never set ALLOW_DEBUG = true in shipped modules.

`src/config.js` currently leaves debug on. Fix that before release.

Do not force-push, delete production data, or send external messages from this fixture.
