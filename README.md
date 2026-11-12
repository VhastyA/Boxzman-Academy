# B Render Family Architecture Academy

The B Render family’s architecture academy teaches architectural drawing, materials, spatial thinking, and design through self-paced courses. The site uses a Node.js server to manage its course catalog, learner accounts, enrollments, quizzes, and uploaded lesson videos.

## Run locally

Requires Node.js 24.15 or newer. From this folder:

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000). Do not open `index.html` directly; the application needs the server for its API and database.

The home page introduces the academy and its courses. Visit [About the academy](http://localhost:3000/about), [Architecture courses](http://localhost:3000/programs), [My learning](http://localhost:3000/student/dashboard), and the [Admin dashboard](http://localhost:3000/admin/dashboard). B Render family contact links are included on the home page.

The public contact details are 055 263 8169, Instagram `@b_render1`, TikTok `@b.render5`, and YouTube `B-render`.

On its first run, the server creates a random local admin password in `.admin-password` and prints its file path in the terminal. Open `/admin/dashboard` and use that password to publish courses with an initial lesson and quiz, add video lessons to existing courses, and remove courses from the catalog. Removing a course also deletes its uploaded lesson videos, enrollments, and lesson progress; this action cannot be undone. MP4, WebM, and MOV uploads are supported up to 100 MB. `.admin-password` and the `data` directory are ignored by Git.

## Demo payment and account flow

Students choose a course and payment method (MTN MoMo, Telecel Cash, or Visa), then use **Simulate payment success** to test checkout. Only after that step can they register. Existing accounts can sign in; the server rejects sign-in if the account has no course enrollment.

**Demo checkout does not contact or verify a payment provider. Do not deploy this demo checkout or accept real payments.** Before launch, integrate a payment provider's server-side transaction verification and configure HTTPS, secure admin credentials, backups, and production hosting.

## Local data

- `data/forma.sqlite`: course, user, session, enrollment, and lesson-progress database.
- `data/videos/`: uploaded lesson videos.
- `.admin-password`: generated local administrator password.

Stop the server with Ctrl+C. Back up the database and video directory together.

## Deploy to Render

This repository includes a Render Blueprint in `render.yaml`. In Render, choose **New → Blueprint**, connect this repository, and apply the Blueprint. It creates a Node web service with a 1 GB persistent disk mounted at `/var/data`, where the SQLite database and uploaded videos are stored. A persistent disk requires a paid Render instance; a free instance would lose these files when it restarts or redeploys.

When prompted for `FORMA_ADMIN_PASSWORD`, enter a strong, unique password and save it securely. The app uses that value for the admin dashboard; it is not stored in the repository. After deployment, open `/admin/dashboard` on the Render URL and sign in with it.

The checkout flow is for demonstration only and does not verify or collect payments. Do not accept real payments until a payment provider with server-side transaction verification is integrated.
