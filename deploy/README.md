# deploy

`portainer-stack.yml` is the production stack for Portainer. Instructions:
[README, "Deploying with Portainer"](../README.md#deploying-with-portainer).
The root `docker-compose.yml` is the plain `docker compose` quick start.

Backups (users export and restore their data in the app; admins create server backups, or `qinqin backup` from cron): [README, "Backup"](../README.md#backup).

HTTPS, the headers a proxy must keep, and what the installable app needs:
[README, "Reverse proxy and HTTPS"](../README.md#reverse-proxy-and-https) and
[Install as an app](../README.md#install-as-an-app-and-study-offline).
