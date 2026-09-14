# Your first canvas

By the end of this you will have pushed a diagram to a server you run, stored in
a GitLab repository you own, and opened it in a browser.

You need Node 22.18 or newer, and a GitLab account.

## 1. Run the server with no store at all

```bash
git clone https://github.com/thejoeejoee/pr-lens-gitlab-backend
cd pr-lens-gitlab-backend
npm ci
STORE=memory npm start
```

It says what it is doing and warns you that `PUBLIC_URL` is unset — which is
fine here, because it will name `localhost` and that is where you are.

## 2. Push something to it

In another terminal, in a repository you would like a diagram of:

```bash
export PR_LENS_API_URL=http://127.0.0.1:8787
npx @coldtea/pr-lens-cli canvas push
```

The CLI mints a canvas, pushes the document and prints two links. Open the view
link. You should see the diagrams, one per drill-down view, following your
system theme.

The `memory` store forgets all of this the moment you stop the server. That is
the point of step 3.

## 3. Give it a repository to keep things in

Create an empty private GitLab project — call it `pr-lens-canvases`. Then, in
**Settings → Access tokens**, create a project access token with the `api` scope
and the **Developer** role.

Stop the server and start it again pointed at both:

```bash
export STORE=gitlab
export GITLAB_PROJECT=your-group/pr-lens-canvases
export GITLAB_TOKEN=glpat-…
npm start
```

If the token or the project is wrong, it refuses to start and says so, rather
than accepting a push and losing it.

## 4. Push again, and look at the repository

```bash
npx @coldtea/pr-lens-cli canvas push
```

Now open your GitLab project. There is a commit called
`canvas <id>: rev 1`, and a file under `canvases/`. Push a second time and there
is a second commit — `git log` over that file is the canvas's history.

## Where to go next

- [Deploy with Helm](how-to/deploy-with-helm.md), for somewhere other than your laptop.
- [Why GitLab works](explanation/why-gitlab.md), for what that commit is really doing.
- [Configuration](reference/configuration.md), for everything you can change.
