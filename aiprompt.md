You are on my production server.

Authoritative infrastructure configuration exists at:

/etc/bjk/deploy.env
/etc/bjk/nginx-app.template

Deploy this repository in-place.

Rules:
- Use Docker Compose if available.
- If none exists, create a production Dockerfile and docker-compose.yml.
- Bind service only to 127.0.0.1:<PORT>.
- Inside Docker containers, binding to 0.0.0.0 is allowed.
- Choose unused port within range defined in deploy.env.
- Do not open firewall ports.
- Do not generate TLS certificates.
- Use wildcard cert from deploy.env.
- Generate nginx config using nginx-app.template.
- Enable site and reload nginx safely.
- If no "/" route exists, optionally redirect "/" to a valid route.

Return only deployment report.
