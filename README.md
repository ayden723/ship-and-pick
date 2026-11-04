# Ship and Pick

Two small mods for Claude Code that make building and shipping websites with Claude smoother.

## Ship Track

A side pane that follows your work from your computer to the live site, in three stops:

**Commit → GitHub → Live**

- **Commit** turns green when everything is committed, or tells you how many files aren't.
- **GitHub** shows whether your branch is pushed, how many commits are waiting, and whether a pull request is open.
- **Live** checks that your site responds, and when Claude deploys with `wrangler`, how many commits have landed since the last deploy.

A stop that's waiting on something pulses amber, and one with a problem turns red. The pane refreshes after every turn and after any git, GitHub or deploy command. It opens by itself in any project that uses git.

Buttons: **Ship it** (asks Claude to commit, push, deploy and check the live site), **Set live URL** and **Refresh**.

Commands:

- `/ship-track` opens the pane
- `/ship-track url https://your-site.com` sets the site to check
- `/ship-track deployed` marks a deploy you did yourself

## Option Picker

When Claude ends a reply with numbered options ("which of these do you want?"), they show up as chips above the message box. Click the ones you want, then **Use** fills in `Do 1, 3` for you to send. Numbered steps that don't offer a choice are left alone, and the chips clear once you send a message.

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
- The live site check is a plain request to the URL you set or the one `wrangler deploy` printed.
- Deploys that happen outside Claude (like Cloudflare's automatic builds from GitHub) aren't recorded, so Ship Track treats a pushed branch plus a responding site as live.
