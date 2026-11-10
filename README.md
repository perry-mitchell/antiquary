# Antiquary

Antiquary — a self-hosted collection manager for anything you own: books, records, games, coins, cameras.
Inspired by [Koillection](https://github.com/koillection/koillection), rebuilt on a modern stack
with a friendlier UI, reusable templates, soft deletes with a trash bin, and a full change
history on every item.

## Features

- **Collections**: Keep all of your items organised how you like.
- **Templates**: Use a template to compose common properties or tie it to a superset so that items added
  can be matched to a known, public identifier. For example, you could use the Super Ninendo superset to
  track how complete your SNES game collection is!
- **History**: Item history is stored and tracked - don't sweat the chnages!
- **MCP**: Plug in your agent to help manage/search your collection.

## Getting Started

### Installation

Antiquary ships as a Docker image on [GitHub Container Registry](https://github.com/perry-mitchell/antiquary/pkgs/container/antiquary):
`ghcr.io/perry-mitchell/antiquary:latest`. Bring a PostgreSQL database, or start everything with this
`compose.yml`:

```yaml
name: antiquary

services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: antiquary
      POSTGRES_PASSWORD: antiquary
      POSTGRES_DB: antiquary
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U antiquary']
      interval: 2s
      timeout: 3s
      retries: 15

  app:
    image: ghcr.io/perry-mitchell/antiquary:latest
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgres://antiquary:antiquary@db:5432/antiquary
    volumes:
      - ./uploads:/data/uploads
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
```

```bash
docker compose up -d
```

Then open <http://localhost:3000>. Migrations run automatically on boot, uploads land in `./uploads`,
and the database lives in the `pgdata` volume.

### Development

Clone this repository and run the stack using docker compose:

```bash
docker compose up --build
```

The console will show the URL with which to access the UI.

### Contributing

We welcome contributions! Please follow the practices visible in the repository already, be respectful, and understand that this is an AI-friendly project.
