import ffmpeg from 'tftg-fluent-ffmpeg';
import { ffmpegPath, ffprobePath } from 'ffmpeg-ffprobe-static';
import { Video } from '../models/Video';
import { Setting } from '../models/Setting';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { Telegram } from '../models/Telegram';
import { getBot } from './telegramBot';
import { TelegramMessage } from '../models/TelegramMessage';
import type { InputMedia, InputMediaPhoto, InputMediaVideo } from 'node-telegram-bot-api';
import { Download } from '../models/Download';
import youtubedl from 'youtube-dl-exec';

ffmpeg.setFfmpegPath(ffmpegPath!);
ffmpeg.setFfprobePath(ffprobePath!);


/**
 * Initiates the video transcoding process for the next waiting video.
 * Fetches a video with 'waiting' status and updates its status to 'transcoding'.
 * If an error occurs during transcoding, the video status is updated to 'error'.
 */
export const transcoding = async function () {
  const video = await Video.findOne({ status: 'waiting', notTranscoding: false });
  const setting = await Setting.findOne();
  if (!video) return;
  if (!setting) return;
  try {
    await Video.updateOne({ _id: video._id }, { status: 'transcoding' });
    transcodeVideo(video.originalPath, setting, video._id.toString());
  } catch (error) {
    console.log(error);
    await Video.updateOne({ _id: video._id }, { status: 'error', errorMessage: error });
  }
}

export const downloading = async function () {
  const downloading = await Download.countDocuments({ status: 'downloading' });
  if (downloading >= 3) return;
  const download = await Download.findOne({ status: 'pending' });
  if (!download) return;
  const outputPath = path.join('./download/', `${download._id}.mp4`);
  try {
    download.status = 'downloading';
    await download.save();
    await youtubedl(download.url, {
      output: outputPath,
      format: 'mp4'
    });
    if (fs.existsSync(outputPath)) {
      const stat = fs.statSync(outputPath);
      download.status = 'completed';
      await download.save();
      console.log(`Download completed: ${download.title}`);
      const videoObj = {
        status: 'waiting',
        title: download.title,
        originalPath: outputPath,
        originalSize: stat.size,
      };
      await Video.create(videoObj);
    } else {
      throw new Error('File not found after download');
    }
  } catch (error) {
    console.error(`Download failed for ${download.title}: ${error.message}`);
    download.status = 'error';
    await download.save();
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
        console.log(`Deleted incomplete file: ${outputPath}`);
      } catch (unlinkError) {
        console.error(`Failed to delete file ${outputPath}: ${unlinkError.message}`);
      }
    }
  }
}

/**
 * Transcodes a video file based on the provided settings.
 * 
 * @param {string} videoPath - The path to the original video file.
 * @param {Setting} options - The transcoding settings.
 * @param {string} id - The unique identifier for the video.
 * @returns {Promise<string>} A promise that resolves with a success message or rejects with an error.
 */
async function transcodeVideo(videoPath: string, options: Setting, id: string): Promise<string> {
  const {
    resolution,
    bitrate,
    frameRate,
    generatePreviewVideo,
    watermarkImage,
    watermarkPosition,
    screenshotCount,
    previewVideoSize,
    posterSize,
    generateThumbnailMosaic,
    generateM3U8Segments
  } = options;


  const resolutionMap = {
    '480p': { width: 640, height: 480 },
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
    '4K': { width: 3840, height: 2160 }
  };

  const outputResolution = resolutionMap[resolution];

  const watermarkScale = (resolution === '1080p') ? 1 : (outputResolution.width / resolutionMap['1080p'].width);
  const watermarkFilter = watermarkImage ? `scale=${Math.round(100 * watermarkScale)}:-1` : null;


  const watermarkPositionMap = {
    topLeft: '10:10',
    topRight: `main_w-overlay_w-10:10`,
    bottomLeft: `10:main_h-overlay_h-10`,
    bottomRight: `main_w-overlay_w-10:main_h-overlay_h-10`
  };

  return new Promise(async (resolve, reject) => {
    const validVideo = await validateVideoFile(videoPath);
    if (!validVideo) {
      await Video.updateOne({ _id: id }, { status: 'error', errorMessage: 'Not a valid video!' });
      return;
    };
    const isVertical = await isPortraitVideo(videoPath).catch(err => { console.error(err); return; });
    await readMetadataAndSave(videoPath, id).catch(err => { console.error(err); return; });
    const size = isVertical ? `-2:${outputResolution.width}` : `${outputResolution.width}:-2`;

    const outputDir = path.join('public', 'videos', id);

    // console.log(outputDir);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await Video.updateOne({ _id: id }, { transcodedPath: outputDir });

    await screenshots(videoPath, outputDir, options, id).catch(err => { console.error(err) });

    if (generatePreviewVideo) {
      const width = previewVideoSize!.width;
      const height = previewVideoSize!.height;
      await generateVideoPreview(id, videoPath, outputDir, width!, height!).catch((err: { message: any; }) => console.log(err.message));
    }

    const outputFilePath = path.join(outputDir, 'output.mp4');

    let command = ffmpeg(videoPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioChannels(2)
      .videoBitrate(bitrate)
      .audioBitrate(128)
      .fps(frameRate);

    if (watermarkImage) {
      command = command.input(watermarkImage)
        .complexFilter([
          `[0:v]scale=${size}[scaled]`,
          `[1:v]${watermarkFilter}[wm]`,
          `[scaled][wm]overlay=${watermarkPositionMap[watermarkPosition]}`
        ]);
    }

    // if (generatePreviewVideo) {
    //   command = command.output('preview.mp4')
    //     .size(`${previewVideoSize!.width}x${previewVideoSize!.height}`);
    // }

    command.output(outputFilePath)
      .on('end', async () => {
        const stats = fs.statSync(outputFilePath);
        const size = stats.size;
        await Video.updateOne({ _id: id }, { status: 'finished', afterSize: size, afterPath: outputFilePath })
        if (generateM3U8Segments) {
          const savepath = outputDir + '/hls';
          await middleadmiaoqiePromise(outputFilePath, outputDir, savepath).catch(err => { console.error(err) });
          await Video.updateOne({ _id: id }, { m3u8Path: savepath + '/output.m3u8' })
        }
        if (videoPath) {
          fs.existsSync(videoPath) && fs.unlinkSync(videoPath);
          fs.existsSync(videoPath + '.json') && fs.unlinkSync(videoPath + '.json');
        }
        const telegram = await Telegram.findOne();
        if (telegram) {
          const telegramMessage = await TelegramMessage.findOne({ videoId: id }).sort('-createdAt');
          if (telegramMessage) {
            const bot = await getBot();
            if (!bot) {
              console.error('Failed to get bot instance');
              return;
            }

            const video = await Video.findOne({ _id: id });
            let media: InputMedia[] = [{
              type: 'video',
              media: outputFilePath,
              duration: Math.round(video!.duration!),
              supports_streaming: true,
              width: video!.dimensions!.width,
              height: video!.dimensions!.height,
              caption: 'Your video has been transcoded.'
            } as InputMediaVideo];
            // await bot.sendVideo(telegramMessage.chatId, outputFilePath, { caption: 'Your video has been transcoded.', reply_to_message_id: telegramMessage.messageId });
            if (video && video.previewVideo) {
              // await bot.sendVideo(telegramMessage.chatId, video.previewVideo, { caption: 'A preview of your video has been generated!', reply_to_message_id: telegramMessage.messageId });
              media.push({
                type: 'video',
                media: video.previewVideo,
                caption: 'A preview of your video has been generated!'
              } as InputMediaVideo)
            }
            if (video && video.thumbnail) {
              media.push({
                type: 'photo',
                media: video.thumbnail,
                caption: 'A thumbnail of your video has been generated!'
              } as InputMediaPhoto)
              // await bot.sendPhoto(telegramMessage.chatId, video.thumbnail, { caption: 'A thumbnail of your video has been generated!', reply_to_message_id: telegramMessage.messageId });
            }

            await bot.sendMediaGroup(telegramMessage.chatId, media, { reply_to_message_id: telegramMessage.messageId });
            // if (video && video.screenshots) {
            //   const media: InputMediaPhoto[] = video.screenshots.map(path => {
            //     return {
            //       type: 'photo',
            //       media: fs.createReadStream(path) as any,
            //     };
            //   });
            //   await bot.sendMediaGroup(telegramMessage.chatId, media, { reply_to_message_id: telegramMessage.messageId });
            // }
          }
        }
        resolve('Transcoding succeeded!');
      })
      .on('error', async (err: { message: any; }) => {
        await Video.updateOne({ _id: id }, { status: 'error', errorMessage: err.message });
        console.error(err);
      }).run();
  });
}

function randomkey(): string {
  const data = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'a', 'b', 'c', 'd', 'e', 'f', 'g',
    'A', 'B', 'C', 'D', 'E', 'F', 'G'
  ];
  
  let result = '';
  for (let i = 0; i < 16; i++) {
    const randomIndex = Math.floor(Math.random() * data.length);
    result += data[randomIndex];
  }
  return result;
}

async function middleadmiaoqiePromise(outputFilePath: string, des: string, savepath: string): Promise<string> {
  const keyInfoPath = `${des}/key.info`;
  const tsKeyPath = `${des}/ts.key`;

  try {
    await fs.promises.mkdir(savepath, { recursive: true });
    
    const chunkconfig = [
      '-map 0:v:0',
      '-map 0:a:0',
      '-c copy',
      '-bsf:v h264_mp4toannexb',
      '-hls_time 4',
      `-hls_segment_filename ${savepath}/media_%d.ts`,
      '-strict -2',
      '-start_number 0',
      '-hls_list_size 0'
    ];

    const keyInfoContent = `${des.replace('public', '')}/ts.key\n${tsKeyPath}`;
    await fs.promises.writeFile(keyInfoPath, keyInfoContent);

    const key = randomkey();
    await fs.promises.writeFile(tsKeyPath, key);

    chunkconfig.push('-hls_key_info_file ' + keyInfoPath);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(outputFilePath)
        .addOptions(chunkconfig)
        .output(`${savepath}/output.m3u8`)
        .on('error', reject)
        .on('end', () => resolve())
        .run();
    });

    await fs.promises.unlink(keyInfoPath);

    return 'Processing completed successfully.';
  } catch (error) {
    console.error('Error during processing:', error);
    
    try {
      const keyInfoExists = await fs.promises.access(keyInfoPath)
        .then(() => true)
        .catch(() => false);
      
      const tsKeyExists = await fs.promises.access(tsKeyPath)
        .then(() => true)
        .catch(() => false);

      if (keyInfoExists) {
        await fs.promises.unlink(keyInfoPath);
        console.log('Deleted key.info file');
      }

      if (tsKeyExists) {
        await fs.promises.unlink(tsKeyPath);
        console.log('Deleted ts.key file');
      }
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }

    throw error;
  }
}

/**
 * Checks if the video is in portrait orientation.
 * 
 * @param {string} videoPath - The path to the video file.
 * @returns {Promise<boolean>} A promise that resolves with true if the video is portrait, false otherwise.
 */
function isPortraitVideo(videoPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(`Error fetching metadata: ${err.message}`);
      } else {
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        if (!videoStream) {
          reject('No video stream found');
        } else {
          const { width, height } = videoStream;
          if (height && width) {
            return resolve(height > width);
          }
          reject(`Video dimensions not found`);
        }
      }
    });
  });
}

/**
 * Validates if the file is a valid video.
 * 
 * @param {string} videoPath - The path to the video file.
 * @returns {Promise<boolean>} A promise that resolves with true if the file is a valid video, false otherwise.
 */
function validateVideoFile(videoPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        resolve(false);
      } else {
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');

        if (!videoStream) {
          resolve(false);
        } else {
          resolve(true);
        }
      }
    });
  });
}

/**
 * Reads video metadata and saves it to the database.
 * 
 * @param {string} videoPath - The path to the video file.
 * @param {string} videoId - The unique identifier for the video.
 * @returns {Promise<void>} A promise that resolves when the metadata is saved.
 */
async function readMetadataAndSave(videoPath: string, videoId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, async (err, metadata) => {
      if (err) {
        return reject(`Error fetching metadata: ${err.message}`);
      }

      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      if (!videoStream) {
        return reject('No video stream found');
      }

      const { width, height } = videoStream;
      const updateData = {
        dimensions: {
          width,
          height
        },
        duration: metadata.format.duration,
        metadata
      };

      try {
        await Video.findByIdAndUpdate(videoId, updateData);
        resolve();
      } catch (updateErr) {
        reject(`Error updating video document: ${updateErr}`);
      }
    });
  });
}

/**
 * Generates screenshots, poster, and thumbnail mosaic for the video.
 * 
 * @param {string} videoPath - The path to the video file.
 * @param {string} outputDir - The directory to save the generated files.
 * @param {Setting} setting - The settings for screenshot generation.
 * @param {string} id - The unique identifier for the video.
 */
async function screenshots(videoPath: string, outputDir: string, setting: Setting, id: string) {
  try {

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const screenshotCount = setting.screenshotCount!;

    // const duration = await getVideoDuration(videoPath);
    const screenshotPaths = await generateScreenshots(videoPath, screenshotCount, outputDir);

    // const rows = Math.ceil(screenshotCount / 4);
    const outputPoster = path.join(outputDir, 'poster.webp');
    let videoObj = { screenshots: screenshotPaths, poster: outputPoster } as {
      screenshots: string[];
      poster: string;
      thumbnail?: string;  // 使用 ? 表示这是一个可选属性
    }
    if (setting.generateThumbnailMosaic) {
      const outputThumbnail = path.join(outputDir, 'thumbnail.webp');
      if (screenshotPaths.length >= 4) {
        await createThumbnailMosaic(screenshotPaths, 2, 2, outputThumbnail);
        videoObj.thumbnail = outputThumbnail;
      }
    }
    await generatePoster(screenshotPaths[0], { height: setting.posterSize!.height!, width: setting.posterSize!.width! }, outputPoster);
    await Video.updateOne({ _id: id }, videoObj)
    console.log('Screenshots and thumbnail created successfully.');
  } catch (error) {
    console.error(error);
  }
}

/**
 * Gets the duration of a video.
 * 
 * @param {string} videoPath - The path to the video file.
 * @returns {Promise<number>} A promise that resolves with the duration of the video in seconds.
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(`Error fetching metadata: ${err.message}`);
      } else {
        resolve(metadata.format.duration as number);
      }
    });
  });
}

/**
 * Generates screenshots from the video.
 * 
 * @param {string} videoPath - The path to the video file.
 * @param {number} screenshotCount - The number of screenshots to generate.
 * @param {number} duration - The duration of the video in seconds.
 * @param {string} outputDir - The directory to save the screenshots.
 * @returns {Promise<string[]>} A promise that resolves with an array of paths to the generated screenshots.
 */
async function generateScreenshots(videoPath: string, screenshotCount: number, outputDir: string): Promise<string[]> {
  const videoInfo = await getVideoFrames(videoPath);
  const totalFrames = parseInt(videoInfo.frames);

  // 确保至少生成一个截图
  screenshotCount = Math.max(1, Math.min(screenshotCount, totalFrames));

  // 计算帧间隔
  const frameInterval = Math.max(1, Math.floor(totalFrames / screenshotCount));

  const screenshotPromises = [];

  for (let i = 0; i < screenshotCount; i++) {
    const frameNumber = Math.min(i * frameInterval, totalFrames - 1);
    const screenshotPath = path.join(outputDir, `screenshot_${i}.webp`);
  
    const screenshotPromise = new Promise<string>((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput(frameNumber / videoInfo.fps)
        .outputOptions([
          '-vframes:v', '1',
          '-c:v', 'libwebp',
          '-quality', '80',
          '-preset', 'picture',
          '-compression_level', '6'
        ])
        .output(screenshotPath)
        .on('end', () => resolve(screenshotPath))
        .on('error', (err) => reject(`Error generating screenshot ${i}: ${err.message}`))
        .run();
    });
  
    screenshotPromises.push(screenshotPromise);
  }

  try {
    // 并行处理所有截图
    const screenshotPaths = await Promise.all(screenshotPromises);
    return screenshotPaths;
  } catch (error) {
    console.error('Error generating screenshots:', error);
    throw error;
  }
}

function getVideoFrames(videoPath: string): Promise<{ frames: string, fps: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        if (videoStream) {
          const duration = parseFloat(videoStream.duration!);
          const [frameRateNum, frameRateDen] = videoStream.r_frame_rate!.split('/');
          const frameRate = parseInt(frameRateNum) / parseInt(frameRateDen);
          if (videoStream.nb_frames) {
            resolve({ frames: videoStream.nb_frames, fps: parseInt(frameRateNum) });
          } else if (videoStream.duration && videoStream.r_frame_rate) {
            const estimatedFrames = Math.floor(duration * frameRate);
            resolve({ frames: estimatedFrames.toString(), fps: parseInt(frameRateNum) });
          } else {
            reject(new Error('Could not determine video frame count or duration'));
          }
        } else {
          reject(new Error('No video stream found'));
        }
      }
    });
  });
}

/**
 * Creates a thumbnail mosaic from the generated screenshots.
 * 
 * @param {string[]} screenshotPaths - An array of paths to the screenshots.
 * @param {number} rows - The number of rows in the mosaic.
 * @param {number} cols - The number of columns in the mosaic.
 * @param {string} outputThumbnail - The path to save the output thumbnail.
 * @returns {Promise<void>} A promise that resolves when the thumbnail is created.
 */
async function createThumbnailMosaic(screenshotPaths: string[], rows: number, cols: number, outputThumbnail: string): Promise<void> {
  // Limit the number of screenshots to MAX_IMAGES
  if (screenshotPaths.length < 4) {
    return;
  }

  const { dir, name, ext } = path.parse(outputThumbnail);
  const limitedPaths = screenshotPaths.slice(0, 12);
  const images = limitedPaths.map(path => sharp(path));
  const { width, height } = await images[0].metadata();

  if (!width || !height) {
    throw new Error('Unable to get dimensions of screenshot');
  }

  const compositeImages = [];

  for (let i = 0; i < images.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    compositeImages.push({
      input: await images[i].toBuffer(),
      top: row * height,
      left: col * width
    });
  }

  const totalWidth = width * cols;
  const totalHeight = height * rows;

  await sharp({
    create: {
      width: width * cols,
      height: height * rows,
      channels: 3,
      background: { r: 0, g: 0, b: 0 }
    }
  })
    .composite(compositeImages)
    .webp({ quality: 80 })
    .toFile(outputThumbnail);

  if (totalWidth + totalHeight > 10000) {
    const scaleFactor = 9000 / (totalWidth + totalHeight);
    const resizedWidth = Math.round(totalWidth * scaleFactor);

    // 重命名原始文件
    const originalThumbnail = path.join(dir, `${name}_original${ext}`);
    fs.copyFileSync(outputThumbnail, originalThumbnail);

    await sharp(originalThumbnail)
      .resize(resizedWidth)
      .webp({ quality: 80 })
      .toFile(outputThumbnail);
  }
}

/**
 * Generates a preview video from the original video.
 * 
 * @param {string} id - The unique identifier for the video.
 * @param {string} inputPath - The path to the input video file.
 * @param {string} outputPath - The path to save the output preview video.
 * @param {number} width - The width of the preview video.
 * @param {number} height - The height of the preview video.
 * @param {number} segmentDuration - The duration of each segment.
 * @param {number} segmentCount - The number of segments to generate.
 * @returns {Promise<string>} A promise that resolves with the path of the generated preview video.
 */
function generateVideoPreview(id: string, inputPath: string, outputDir: string, width: number, height: number, segmentDuration: number = 2, segmentCount: number = 5): Promise<string> {
  const previewVideo = path.join(outputDir, 'preview.mp4');
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const duration = metadata.format.duration!;
      if (duration < segmentDuration * segmentCount) {
        reject(`Cannot generate video preview, video is shorter than ${segmentDuration * segmentCount} seconds`);
        return;
      }

      const interval = (duration - segmentDuration) / (segmentCount - 1);

      const segmentPromises: Promise<string>[] = [];

      for (let i = 0; i < segmentCount; i++) {
        const startTime = i * interval;
        const segmentOutputPath = path.join(outputDir, `preview${i + 1}.mp4`);
        segmentPromises.push(generateSegment(inputPath, segmentOutputPath, startTime, segmentDuration, width, height));
      }

      Promise.all(segmentPromises)
        .then(segmentPaths => concatenateVideos(segmentPaths, previewVideo, outputDir))
        .then(async () => {
          await Video.updateOne({ _id: id }, { previewVideo })
          resolve(previewVideo)
        })
        .catch(reject);
    });
  });
}

// export const generatePreviewVideoForBot = async function (id: string) {
//   const video = await Video.findOne({ _id: id });
//   const setting = await Setting.findOne({});
//   if (!video) {
//     return;
//   }
//   const filePath = video.originalPath;
//   const validVideo = await validateVideoFile(filePath)
//   if (!validVideo) {
//     return;
//   }
//   const outputDir = path.join('public', 'videos', video._id.toString());
//   if (!fs.existsSync(outputDir)) {
//     fs.mkdirSync(outputDir, { recursive: true });
//   }
//   const previewVideo = await generateVideoPreview(video._id.toString(), filePath, outputDir, setting!.previewVideoSize!.width!, setting!.previewVideoSize!.height!);
//   return previewVideo;
// }

// export const generateThumbnailMosaicForBot = async function (id: string) {
//   const video = await Video.findOne({ _id: id });
//   if (!video) {
//     return;
//   }
//   const filePath = video.originalPath;
//   const validVideo = await validateVideoFile(filePath)
//   if (!validVideo) {
//     return;
//   }
//   const outputDir = path.join('public', 'videos', video._id.toString());
//   if (!fs.existsSync(outputDir)) {
//     fs.mkdirSync(outputDir, { recursive: true });
//   }
//   const screenshotCount = 12;

//   const screenshotPaths = await generateScreenshots(filePath, screenshotCount, outputDir);

//   const outputThumbnail = path.join(outputDir, 'thumbnail.jpg');
//   if (screenshotPaths.length >= 12) {
//     await createThumbnailMosaic(screenshotPaths, 3, 4, outputThumbnail);
//   }
//   return outputThumbnail;
// }

function generateSegment(inputPath: string, outputPath: string, startTime: number, duration: number, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(duration)
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-movflags faststart',
        `-vf scale=${width === 0 ? -2 : width}:${height === 0 ? -2 : height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:-1:-1:color=black`
      ])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

function concatenateVideos(inputPaths: string[], outputPath: string, outputDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const listFile = path.join(outputDir, 'filelist.txt');
    const fileListContent = inputPaths.map(p => `file '${path.resolve(p)}'`).join('\n');

    fs.writeFileSync(listFile, fileListContent);

    ffmpeg()
      .input(listFile)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(outputPath)
      .on('end', () => {
        fs.unlinkSync(listFile);
        inputPaths.forEach(p => fs.unlinkSync(p));
        resolve(outputPath);
      })
      .on('error', err => {
        fs.unlinkSync(listFile);
        reject(err);
      })
      .run();
  });
}
/**
 * Generates a poster image from a screenshot.
 * 
 * @param {string} screenshotPath - The path to the screenshot image.
 * @param {Object} posterSize - An object containing the width and height of the poster.
 * @param {number} posterSize.width - The width of the poster.
 * @param {number} posterSize.height - The height of the poster.
 * @param {string} outputPosterPath - The path to save the generated poster.
 * @returns {Promise<void>} A promise that resolves when the poster is generated.
 */
async function generatePoster(screenshotPath: string, posterSize: { width: number; height: number }, outputPosterPath: string): Promise<void> {
  const width = posterSize.width === 0 ? null : posterSize.width;
  const height = posterSize.height === 0 ? null : posterSize.height;
  await sharp(screenshotPath)
    .resize(width, height)
    .webp({ quality: 80 })
    .toFile(outputPosterPath);
}