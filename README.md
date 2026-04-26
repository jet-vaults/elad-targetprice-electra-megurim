# elad-targetprice-electra-megurim

## Status

| | |
|---|---|
| **Domain** | `https://elad-targetprice.electra-megurim.com` |
| **Pages URL** | `https://elad-targetprice-electra-megurim.pages.dev` |
| **Public storage** | `https://jetvaults.blob.core.windows.net/elad-targetprice-electra-megurim/` |
| **Private storage** | `https://jetvaults.blob.core.windows.net/elad-targetprice-electra-megurim-private/` |
| **Public container** | `elad-targetprice-electra-megurim` |
| **Private container** | `elad-targetprice-electra-megurim-private` |
| **Activated** | Yes |

## CNAME

Create this DNS record with your DNS provider:

| Type | Name | Value |
|------|------|-------|
| CNAME | `elad-targetprice.electra-megurim.com` | `elad-targetprice-electra-megurim.pages.dev` |

After DNS propagates, Cloudflare Pages will validate the custom domain and issue SSL. You do not need to run the Activate Site workflow for CNAME sites.

## Development

Edit files in `wwwroot/` and push to `main` - Cloudflare Pages auto-deploys.

Only the `wwwroot/` directory is served. Everything else stays in the repo.
