# Ship and Pick

Two small mods for Claude Code that make building and shipping websites with Claude smoother.

## Ship Track

Follows your work from your computer to the live site, in three stops:

**Commit → GitHub → Live**

- **Commit** turns green when everything is committed, or tells you how many files aren't.
- **GitHub** shows whether your branch is pushed, how many commits are waiting, and whether a pull request is open.
- **Live** checks that your site responds, and when Claude deploys with `wrangler`, how many commits have landed since the last deploy.

Most of the time it stays out of sight. When something is waiting (files not committed, commits not pushed, the site behind or not answering), one row shows above the prompt between turns, with the repo's name, what's waiting, **Ship it** and **Details**. It goes away once everything is shipped.

**Details** (or `/ship-track`) opens the full pane, where a stop that's waiting pulses amber and one with a problem turns red. Ship Track checks again after every turn and after any git, GitHub or deploy command. When Claude ships from another folder (`cd other-repo && git push`), Ship Track follows that repo and names it; **Track this folder** switches back.

Pane buttons: **Ship it** (asks Claude to commit, push, deploy and check the live site), **Set live URL** and **Refresh**.

Commands:

- `/ship-track` opens the pane
- `/ship-track here` tracks the session's own folder again
- `/ship-track url https://your-site.com` sets the site to check
- `/ship-track url` on its own forgets the site and finds it again
- `/ship-track deployed` marks a deploy you did yourself

## Option Picker

When Claude ends a reply with numbered options ("which of these do you want?"), they show up as chips above the message box. Click the ones you want, or press their numbers in an empty prompt, then **Use** fills in `Do 1, 3` for you to send. Numbered steps that don't offer a choice, numbered lists inside code blocks, and sub-steps under an option are left alone. The chips clear once you send a message.

## Install

At the prompt of a terminal session:

```
/plugin install ship-track --marketplace ayden723/ship-and-pick
/plugin install option-picker --marketplace ayden723/ship-and-pick
```

From a shell:

```bash
claude plugin install ship-track --marketplace ayden723/ship-and-pick
```

```bash
claude plugin install option-picker --marketplace ayden723/ship-and-pick
```

In the Claude desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `ayden723/ship-and-pick`, then **Add plugin**.

Answer `y` to add the marketplace, then pick a scope. Each mod works on its own.

## Notes

- Ship Track runs `git` and, if you have it, `gh` in your project folder. It only reads; it never commits or pushes.
- With no live URL set, Ship Track finds it: a custom domain in `wrangler.jsonc` or `wrangler.toml`, the website on the GitHub repo, a link to the Worker in the README or CLAUDE.md, then the Worker's own workers.dev address. It keeps the first one that answers and labels it "found automatically". The workers.dev address needs your account's workers.dev name, which Ship Track picks up from any workers.dev link it has seen in a deploy, a command or a URL you set.
- The live site check is a plain request to the URL you set, the one it found, or the workers.dev or pages.dev address `wrangler deploy` printed. A URL you set yourself is never replaced by a deploy. A site that doesn't answer within 6 seconds shows as not reachable.
- Deploys that happen outside Claude (like Cloudflare's automatic builds from GitHub) aren't recorded, so Ship Track treats a pushed branch plus a responding site as live.
