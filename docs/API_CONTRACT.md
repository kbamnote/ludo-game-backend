# API Contract — Avatars (Phase 3)

The HTTP surface the mobile client codes against. This document is the
authority; `ludo-mobile` consumes it and never invents a shape of its own
(risk R12).

Base URL comes from `EXPO_PUBLIC_API_URL` on the client. All routes require a
bearer token except where noted.

---

## Why the client never talks to the AI provider

The provider API key is a production secret. If it ships in the app it is
extractable from the bundle, full stop — obfuscation does not change that. So
the flow is always:

```
mobile ──► ludo-server ──► AI provider
       ◄──              ◄──
```

The client uploads a photo and polls a job. It never sees a provider URL, a
key, or a provider-shaped response. Swapping provider changes server code only.

---

## 1. Request an upload slot

```
POST /v1/avatars/uploads
```

Returns a short-lived signed URL the client PUTs the photo to, so the image
never passes through the API process.

**Request**
```json
{ "contentType": "image/jpeg", "byteSize": 184320 }
```

**Response `201`**
```json
{
  "uploadId": "upl_01HT...",
  "uploadUrl": "https://storage.example/...?X-Amz-Signature=...",
  "expiresInSeconds": 300,
  "maxBytes": 8388608
}
```

**Errors** — `413` payload too large · `415` unsupported type (only
`image/jpeg`, `image/png`, `image/webp`) · `429` rate limited.

---

## 2. Start a generation job

```
POST /v1/avatars/jobs
```

Consent is recorded here, not assumed. A request without
`consent.acceptedAt` is rejected — the server must be able to prove consent
was given, which means it cannot be implied by the upload alone.

**Request**
```json
{
  "uploadId": "upl_01HT...",
  "styleId": "cyber-streetwear",
  "consent": {
    "acceptedAt": "2026-11-13T14:21:09.000Z",
    "policyVersion": "2026-11-01",
    "scope": ["generate_avatar", "store_avatar"]
  }
}
```

**Response `202`**
```json
{ "jobId": "job_01HT...", "status": "queued", "pollAfterMs": 1500 }
```

**Errors** — `400` missing or malformed consent · `404` unknown upload ·
`409` upload already consumed · `429` rate limited.

---

## 3. Poll a job

```
GET /v1/avatars/jobs/{jobId}
```

Generation takes seconds to tens of seconds, so this is async by design. A
synchronous request would sit on a mobile connection long enough to be killed
by the OS or a proxy.

**Response `200`**
```json
{
  "jobId": "job_01HT...",
  "status": "succeeded",
  "progress": 1,
  "results": [
    {
      "avatarId": "avt_01HT...",
      "styleId": "cyber-streetwear",
      "url": "https://cdn.example/avatars/...jpg?sig=...",
      "width": 1024,
      "height": 1024,
      "expiresInSeconds": 3600
    }
  ]
}
```

`status` is one of `queued` · `running` · `succeeded` · `failed`.
On `failed` the body carries `error: { code, message }` with a message safe to
show a user. Provider errors are never passed through verbatim.

**The source photo is deleted once a job reaches a terminal state.** It exists
only long enough to generate from.

---

## 4. List, equip, delete

```
GET    /v1/avatars                 -> { avatars: [...] }
POST   /v1/avatars/{id}/equip      -> { equipped: true }
DELETE /v1/avatars/{id}            -> 204
DELETE /v1/avatars                 -> 204   (all avatars + any source photos)
```

`DELETE` is a hard delete: database row, object storage, and cache. It is not a
soft flag. The brief requires users can delete uploaded photos and generated
avatars, and a `deleted_at` column does not satisfy that.

---

## 5. Styles

```
GET /v1/avatars/styles             (no auth)
```

```json
{
  "policyVersion": "2026-11-01",
  "styles": [
    { "id": "cyber-streetwear", "name": "Cyber Streetwear", "blurb": "...", "preview": "https://..." }
  ]
}
```

Served by the server so styles can be added or retired without an app release.

---

## Privacy rules binding on both repos

1. Avatars are **private by default**. Visibility is opt-in, never inferred.
2. The **source photo is deleted** as soon as generation finishes or fails.
3. Consent is **recorded with a timestamp and policy version**, never implied.
4. Delivery URLs are **short-lived and signed**; no public bucket.
5. **No provider key, URL or model name** is ever sent to the client.
6. Deletion is **hard** and covers database, storage and caches.
