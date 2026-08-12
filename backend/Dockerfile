# package*.json copied and installed before the rest of the source so this
# layer only rebuilds when dependencies actually change, not on every edit.
FROM node:22-alpine
WORKDIR /app

# Alpine has no timezone data or TZ setting by default, so Node's Date
# would otherwise treat wall-clock numbers as UTC — but pickupDate/
# pickupTime are plain Central-time wall-clock values (see
# validatePickupDateTime in index.js), same as the browser's local time for
# this single-location, Nebraska-based shop. Without this, the container's
# "now" and the frontend's "now" disagree by the UTC offset, throwing off
# the 24-hour pickup notice check.
RUN apk add --no-cache tzdata
ENV TZ=America/Chicago

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# AWS credentials, Cognito/SES/USPS config, SES_SENDER_EMAIL, etc. all come
# from the environment at container run time (docker-compose's env_file
# locally, an ECS task definition in production) — never baked into the
# image itself. See .dockerignore: .env never even reaches the build context.
EXPOSE 4000
CMD ["node", "index.js"]
