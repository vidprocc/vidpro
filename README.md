# VidPro

VidPro is a comprehensive cloud-based video processing solution offering a wide range of features. It provides video transcoding to various resolutions, image watermarking, thumbnail and preview video generation, cover image and screenshot creation, and M3U8 stream support. The platform enables online preview of processed media, supports resumable video uploads, and integrates a Telegram bot for seamless workflow. VidPro also includes a multi-platform video downloader supporting numerous websites. This all-in-one tool streamlines video processing from acquisition to delivery, catering to content creators, marketers, and businesses.

## Features

1. Cloud Video Processing: Convert videos to MP4 format in 480p, 720p, 1080p, or 4K resolutions.
2. Image Watermarking: Protect your content by adding customizable image watermarks.
3. Thumbnail Generation: Automatically create attractive thumbnails and preview images.
4. Preview Video Creation: Generate compact, high-quality preview videos as an efficient alternative to GIF covers.
5. Cover Image and Screenshot Generation: Produce static images for various promotional and preview purposes.
6. M3U8 Support: Create HLS (HTTP Live Streaming) M3U8 playlists for adaptive bitrate streaming.
7. Online Preview: Serve processed MP4 videos, thumbnails, preview videos, screenshots, and M3U8 streams directly for web use.
8. Resumable Video Upload: resumable file uploads Tus resumable upload protocol in Node.js.
9. Telegram Bot Integration: Download videos from Telegram channels or chats, process them with VidPro, and receive generated media and links directly in Telegram.
10. Multi-Platform Video Downloader: Utilize integrated yt-dlp downloader to acquire videos from YouTube, Facebook, Twitter, M3U8 stream websites, and numerous other platforms (supported sites: https://ytdl-org.github.io/youtube-dl/supportedsites.html).

## Screenshots

![Screenshot](public/images/image.png "VidPro")
![FFmpegSetting](public/images/ffmpegsetting.png "VidPro")

## Installation

### Docker install Telegram Bot API

Before start, you will need to obtain api-id and api-hash as described in [https://core.telegram.org/api/obtaining_api_id](https://core.telegram.org/api/obtaining_api_id)⁠ and specify them using the TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables.

```
docker run -d -p 8082:8081 --name=telegram-bot-api --restart=always -v /var/lib/telegram-bot-api:/var/lib/telegram-bot-api -e TELEGRAM_API_ID=TELEGRAM_API_ID -e TELEGRAM_API_HASH=TELEGRAM_API_HASH -e TELEGRAM_LOCAL=true aiogram/telegram-bot-api:latest
```

#### docker install

**Initialization Configuration**

```
docker run -d --restart=unless-stopped \
  -e EMAIL_URL="your_email_url" \
  -e INITEMAIL="your_admin_email" \
  -e INITPASSWORD="your_admin_password" \
  -v /root/data:/data/logs \
  -p 3333:3333 \
  -p 1088:1088 \
  --name vidpro \
  vidpro/vidpro
```

**If you have a new database, your own MongoDB database**

```
docker run -d --restart=unless-stopped \
  -e MONGO_URL="mongodb://tftg:tftg@localhost:27017/tftg" \
  -e EMAIL_URL="your_email_url" \
  -e INITEMAIL="your_admin_email" \
  -e INITPASSWORD="your_admin_password" \
  -v /root/data:/data/logs \
  -p 3333:3333 \
  -p 1088:1088 \
  --name vidpro \
  vidpro/vidpro
```

**If you have a domain name**

```
docker run -d --restart=unless-stopped \
  -e MONGO_URL="mongodb://tftg:tftg@localhost:27017/tftg" \
  -e HOST="http://domain.com" \
  -e TUS_HOST="http://domain.com" \
  -e LOCAL_TG_SERVER="http://domain.com" \
  -e EMAIL_URL="your_email_url" \
  -e INITEMAIL="your_admin_email" \
  -e INITPASSWORD="your_admin_password" \
  -v /root/data:/data/logs \
  -p 3333:3333 \
  -p 1088:1088 \
  --name vidpro \
  vidpro/vidpro
```

`-e MONGO_URL="mongodb://tftg:tftg@localhost:27017/tftg"`: Sets the environment variable `MONGO_URL` to specify the MongoDB connection string.

`-e HOST="http://domain.com"`: Sets the environment variable `HOST` to the base URL of the application.

`-e TUS_HOST="http://domain.com"`: Sets the environment variable `TUS_HOST` to the base URL for TUS (Upload Service) functionality.

`-e LOCAL_TG_SERVER="http://domain.com"`: Sets the environment variable `LOCAL_TG_SERVER` to the local Telegram server URL.

`-e EMAIL_URL="your_email_url"`: Sets the environment variable `EMAIL_URL` to the URL for email services.

`-e INITEMAIL="your_admin_email"`: Sets the environment variable `INITEMAIL` to the initial admin email address.

`-e INITPASSWORD="your_admin_password"`: Sets the environment variable `INITPASSWORD` to the initial admin password.

`-v /root/data:/data/logs`: Mounts the host directory `/root/data` to the container directory `/data/logs` for logging purposes.

`-p 3333:3333`: Maps port `3333` on the host to port `3333` on the container.

`-p 1088:1088`: Maps port `1088` on the host to port `1088` on the container.

`--name vidpro`: Names the container `tftgbot`.

`vidpro/vidpro`: Specifies the Docker image to use for the container.

#### Manual install

Here we assume that you are using Ubuntu 22.04 system.

#### Install Mongodb And Setup

```
sudo apt-get install gnupg curl
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
   sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg \
   --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl start mongod
mongosh
use tftg
db.createUser( { user: "tftg", pwd: "tftg", roles: [ { role: "readWrite", db: "tftg" } ] } )
```

#### Install bunjs

```
curl -fsSL https://bun.sh/install | bash
```

After installation, re-enter SSH

#### Install redis-server

```
sudo apt update
sudo apt install redis-server
sudo nano /etc/redis/redis.conf
```

/etc/redis/redis.conf

```
# If you run Redis from upstart or systemd, Redis can interact with your
# supervision tree. Options:
#   supervised no      - no supervision interaction
#   supervised upstart - signal upstart by putting Redis into SIGSTOP mode
#   supervised systemd - signal systemd by writing READY=1 to $NOTIFY_SOCKET
#   supervised auto    - detect upstart or systemd method based on
#                        UPSTART_JOB or NOTIFY_SOCKET environment variables
# Note: these supervision methods only signal "process is ready."
#       They do not enable continuous liveness pings back to your supervisor.
supervised systemd
sudo systemctl restart redis.service
```

#### Install pm2 and setup .env

```
git clone https://github.com/vidprocc/vidpro
cd vidpro
yarn  ### npm install
yarn global add pm2
```

Change env.example to .env and edit

```
HOST=http://yourip:3333
TUS_HOST=http://yourip:1088
INITEMAIL=admin@admin.com
INITPASSWORD=adminadmin
MONGO_URL=mongodb://tftg:tftg@localhost:27017/tftg
EMAIL_URL=tftg.cloud
LOCAL_TG_SERVER=yourip:8082
SESSION_SECRET=yoursessionsecret
JWTSECRET=yourjwtsecret
```

INITEMAL：init admin email.
INITPASSWORD: init admin password.

#### starup tus server and application

```
pm2 start tus.cjs
pm2 start --interpreter ~/.bun/bin/bun index.ts
```

Now you can access IP:3333 and access your dashboard.

## License

Mit License
