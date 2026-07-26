# package*.json copied and installed before the rest of the source so this
# layer only rebuilds when dependencies actually change, not on every edit.
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# AWS credentials, Cognito/SES/USPS config, SES_SENDER_EMAIL, etc. all come
# from the environment at container run time (docker-compose's env_file
# locally, an ECS task definition in production) — never baked into the
# image itself. See .dockerignore: .env never even reaches the build context.
EXPOSE 4000
CMD ["node", "index.js"]
