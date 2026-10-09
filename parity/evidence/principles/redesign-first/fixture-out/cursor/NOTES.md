# Notes

We now ship internationally. Every product price must name its currency.

One quick path is to keep numeric `price` and add an optional `currency` field (or a helper that wraps old products). Prefer making currency part of the core Price shape everywhere instead, including docs and examples.

Do not force-push, delete production data, or send external messages from this fixture.
