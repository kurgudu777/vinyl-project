# vinyl-project

Initial project scaffold.

## Stack

- Node.js (and/or Python) — to be decided as the project grows.
- Git + GitHub for version control.
- `.env` for local configuration (see `.env.example`).

## Getting started

```bash
# 1. Clone
git clone git@github.com:<your-user>/vinyl-project.git
cd vinyl-project

# 2. Configure environment
cp .env.example .env
# then edit .env with real values

# 3. Install dependencies (once a package manager is chosen)
# npm install
# or: pip install -r requirements.txt
```

## Project layout

```
.
├── .env.example      # template for environment variables
├── .gitignore        # ignored files (Node + Python)
├── CLAUDE.md         # rules/context for Claude Code
└── README.md         # you are here
```

## Contributing

- Do not commit `.env` or any secrets.
- Keep `.env.example` in sync when adding new variables.
- Follow the conventions in `CLAUDE.md` when working with Claude Code in this repo.

## License

TBD.
