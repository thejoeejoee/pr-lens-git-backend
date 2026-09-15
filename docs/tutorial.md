# Your first canvas

By the end of this you will have pushed a diagram to a server you run, stored in
a git repository you own, and opened it in a browser.

You need Node 22.18 or newer, `git` on the path, and somewhere to put a
repository — GitLab, GitHub, Gitea, or a host of your own. No clone, no checkout:
the server does its own, and never checks anything out of it.

## 1. Run the server with no store at all

```bash
STORE=memory npx pr-lens-git-backend
```

It says what it is doing and warns you that `PUBLIC_URL` is unset — fine here,
because it will name `localhost` and that is where you are.

> Before the first npm release, or to run an unreleased change, install straight
> from the repository instead. It builds itself on the way in:
>
> ```bash
> STORE=memory npx github:thejoeejoee/pr-lens-git-backend
> ```

## 2. Push something to it

In another terminal, in a repository you would like a diagram of:

```bash
export PR_LENS_API_URL=http://127.0.0.1:8787
npx @coldtea/pr-lens-cli canvas push
```

The CLI mints a canvas, pushes the document and prints two links. Open the view
link. You should see the diagrams, one per drill-down view, following your system
theme.

The `memory` store forgets all of this the moment you stop the server. That is
the point of step 3.

## 3. Give it a repository to keep things in

Create an empty private repository — call it `pr-lens-canvases` — and a token
that may write to it. On GitLab that is **Settings → Access tokens**, scope
`write_repository`, Developer role; on GitHub, a fine-grained PAT with
**Contents: read and write**. Other hosts are in
[connect a remote](how-to/connect-a-remote.md).

Stop the server and start it again pointed at both:

```bash
STORE=git \
GIT_REMOTE=https://gitlab.com/your-group/pr-lens-canvases.git \
GIT_TOKEN=glpat-… \
  npx pr-lens-git-backend
```

If the token or the remote is wrong it refuses to start and says so, rather than
accepting a push and losing it. An empty repository is fine — the first push
makes the branch.

## 4. Push again, and look at the repository

```bash
npx @coldtea/pr-lens-cli canvas push
```

Now open your repository. There is a commit called `canvas <id>: rev 1`, and
a file under `canvases/`. Push a second time and there is a second commit —
`git log` over that file is the canvas's history.

## Where to go next

- [Deploy with Helm](how-to/deploy-with-helm.md), for somewhere other than your laptop.
- [Why git works](explanation/why-git.md), for what that commit is really doing.
- [Configuration](reference/configuration.md), for everything you can change.

To work on the server rather than with it, clone it: `npm ci && npm test` needs
nothing else.
