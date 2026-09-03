import { dirname, join } from 'node:path';
import { addBenchmarkOverlay, recordBrowserPage, recordBrowserPageDeterministic } from './browser.mjs';
import { runProcess } from './process.mjs';
import {
  BenchmarkError,
  SKILL_ROOT,
  ensureDirectory,
  fileSize,
  pathExists,
  resolveInside,
  writeUtf8,
} from './utils.mjs';

export async function createFailureRecording({ outputPath, modelLabel, promptTitle, reason, videoPolicy, captureMode = 'realtime' }) {
  const load = async (page) => {
    await page.setContent(`<!doctype html>
      <html><body style="margin:0;width:100vw;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 35%,#202735,#080b10 68%);color:white;font-family:Arial,sans-serif">
        <section style="width:min(76vw,680px);padding:34px;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:rgba(0,0,0,.38);text-align:center;box-shadow:0 20px 70px rgba(0,0,0,.45)">
          <div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#ff9b8f">Executable result unavailable</div>
          <h1 style="font-size:32px;margin:14px 0 12px">Repair budget exhausted</h1>
          <p id="reason" style="font-size:15px;line-height:1.55;color:#cbd3df;margin:0"></p>
        </section>
      </body></html>`);
    await page.locator('#reason').evaluate((node, text) => { node.textContent = text; }, String(reason).slice(0, 500));
    await addBenchmarkOverlay(page, { modelLabel, promptTitle });
  };
  if (captureMode === 'deterministic-frame') {
    return await recordBrowserPageDeterministic({
      outputPath,
      width: videoPolicy.participantWidth,
      height: videoPolicy.participantHeight,
      durationMs: videoPolicy.durationSeconds * 1000,
      framesPerSecond: videoPolicy.framesPerSecond,
      deterministicPolicy: videoPolicy.deterministicFallback,
      interaction: 'none',
      load,
    });
  }
  return await recordBrowserPage({
    outputPath,
    width: videoPolicy.participantWidth,
    height: videoPolicy.participantHeight,
    durationMs: videoPolicy.durationSeconds * 1000,
    framesPerSecond: videoPolicy.framesPerSecond,
      captureFramesPerSecond: videoPolicy.captureFramesPerSecond,
      captureBitrateBitsPerSecond: videoPolicy.captureBitrateBitsPerSecond,
      cadencePolicy: videoPolicy.cadence,
    load: async (page) => {
      await load(page);
      // Give Playwright's native recorder time to emit its first frames before
      // the exact 12-second interaction interval begins.
      await page.waitForTimeout(800);
    },
    interact: async (page, durationMs) => {
      await page.waitForTimeout(durationMs);
    },
  });
}

export async function composeComparison({ topPath, bottomPath, outputPath, videoPolicy, logDirectory }) {
  await ensureDirectory(dirname(outputPath));
  if (videoPolicy.target !== 'x'
    || videoPolicy.layout !== 'vertical-stack'
    || videoPolicy.outputWidth !== videoPolicy.participantWidth
    || videoPolicy.outputHeight !== videoPolicy.participantHeight * 2) {
    throw new BenchmarkError('Video dimensions are incompatible with the X vertical-stack composition.', { kind: 'configuration' });
  }

  const audioPolicy = videoPolicy.audio;
  const soundtrackPath = resolveInside(
    SKILL_ROOT,
    join(SKILL_ROOT, audioPolicy.asset),
    'soundtrack asset',
  );
  if (!(await pathExists(soundtrackPath))) {
    throw new BenchmarkError('The local soundtrack asset is missing. Run: npm run fetch:bgm', { kind: 'configuration' });
  }
  const fadeOutStart = Math.max(0, videoPolicy.durationSeconds - audioPolicy.fadeOutSeconds);
  const filter = [
    `[0:v]fps=${videoPolicy.framesPerSecond},scale=${videoPolicy.participantWidth}:${videoPolicy.participantHeight}:flags=lanczos,format=${videoPolicy.pixelFormat},setsar=1[top]`,
    `[1:v]fps=${videoPolicy.framesPerSecond},scale=${videoPolicy.participantWidth}:${videoPolicy.participantHeight}:flags=lanczos,format=${videoPolicy.pixelFormat},setsar=1[bottom]`,
    `[top][bottom]vstack=inputs=2[outv]`,
    `[2:a]atrim=duration=${videoPolicy.durationSeconds},asetpts=PTS-STARTPTS,volume=${audioPolicy.volume},afade=t=in:st=0:d=${audioPolicy.fadeInSeconds},afade=t=out:st=${fadeOutStart}:d=${audioPolicy.fadeOutSeconds},aformat=sample_rates=${audioPolicy.sampleRate}:channel_layouts=stereo[outa]`,
  ].join(';');

  const result = await runProcess({
    command: 'ffmpeg',
    args: [
      '-hide_banner', '-y',
      '-sseof', String(-videoPolicy.durationSeconds), '-i', topPath,
      '-sseof', String(-videoPolicy.durationSeconds), '-i', bottomPath,
      '-stream_loop', '-1', '-ss', String(audioPolicy.startSeconds), '-i', soundtrackPath,
      '-filter_complex', filter,
      '-map', '[outv]',
      '-map', '[outa]',
      '-t', String(videoPolicy.durationSeconds),
      '-c:v', videoPolicy.codec,
      '-profile:v', videoPolicy.profile,
      '-level:v', videoPolicy.level,
      '-crf', String(videoPolicy.crf),
      '-preset', videoPolicy.preset,
      '-maxrate', String(videoPolicy.maximumBitrateBitsPerSecond),
      '-bufsize', String(videoPolicy.maximumBitrateBitsPerSecond * 2),
      '-g', String(videoPolicy.framesPerSecond * 2),
      '-pix_fmt', videoPolicy.pixelFormat,
      '-color_range', 'tv',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-c:a', audioPolicy.codec,
      '-b:a', String(audioPolicy.bitrateBitsPerSecond),
      '-ar', String(audioPolicy.sampleRate),
      '-ac', String(audioPolicy.channels),
      '-movflags', '+faststart',
      outputPath,
    ],
    timeoutMs: 300000,
  });
  await writeUtf8(join(logDirectory, 'ffmpeg.log'), `${result.stdout}\n${result.stderr}`);
  if (result.exitCode !== 0 || result.timedOut) {
    throw new BenchmarkError('FFmpeg could not compose the comparison video.', {
      kind: 'infrastructure',
      details: result.stderr.slice(-5000),
    });
  }
  return await probeVideo(outputPath, videoPolicy);
}

export async function probeVideo(outputPath, videoPolicy) {
  const result = await runProcess({
    command: 'ffprobe',
    args: [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,codec_name,profile,width,height,pix_fmt,avg_frame_rate,bit_rate,sample_rate,channels:format=duration,size,bit_rate',
      '-of', 'json',
      outputPath,
    ],
    timeoutMs: 30000,
  });
  if (result.exitCode !== 0) {
    throw new BenchmarkError('FFprobe could not inspect the composed video.', {
      kind: 'infrastructure',
      details: result.stderr,
    });
  }
  const probe = JSON.parse(result.stdout);
  const stream = probe.streams?.find((candidate) => candidate.codec_type === 'video');
  const audioStream = probe.streams?.find((candidate) => candidate.codec_type === 'audio');
  const duration = Number(probe.format?.duration);
  const outputSize = await fileSize(outputPath);
  const [frameNumerator, frameDenominator] = String(stream?.avg_frame_rate ?? '').split('/').map(Number);
  const frameRate = frameDenominator > 0 ? frameNumerator / frameDenominator : Number.NaN;
  const bitrate = Number(probe.format?.bit_rate ?? stream?.bit_rate)
    || (Number.isFinite(duration) && duration > 0 ? outputSize * 8 / duration : Number.NaN);
  const failures = [];
  if (stream?.codec_name !== 'h264') failures.push(`codec=${stream?.codec_name}`);
  if (String(stream?.profile).toLowerCase() !== videoPolicy.profile.toLowerCase()) failures.push(`profile=${stream?.profile}`);
  if (stream?.pix_fmt !== videoPolicy.pixelFormat) failures.push(`pixelFormat=${stream?.pix_fmt}`);
  if (stream?.width !== videoPolicy.outputWidth || stream?.height !== videoPolicy.outputHeight) {
    failures.push(`dimensions=${stream?.width}x${stream?.height}`);
  }
  if (!Number.isFinite(duration) || duration < videoPolicy.durationSeconds - 1) failures.push(`duration=${duration}`);
  if (duration > 140.01) failures.push(`xDuration=${duration}`);
  if (!Number.isFinite(frameRate) || Math.abs(frameRate - videoPolicy.framesPerSecond) > 0.01 || frameRate > 40) {
    failures.push(`frameRate=${frameRate}`);
  }
  if (!Number.isFinite(bitrate) || bitrate > videoPolicy.maximumBitrateBitsPerSecond) failures.push(`bitrate=${bitrate}`);
  if (outputSize > videoPolicy.maximumFileSizeBytes) failures.push(`fileSize=${outputSize}`);
  if (outputSize < 2_000) failures.push('file is unexpectedly small');
  if (videoPolicy.audio.enabled) {
    if (!audioStream) failures.push('audio stream is missing');
    else {
      if (audioStream.codec_name !== videoPolicy.audio.codec) failures.push(`audioCodec=${audioStream.codec_name}`);
      if (Number(audioStream.sample_rate) !== videoPolicy.audio.sampleRate) failures.push(`audioSampleRate=${audioStream.sample_rate}`);
      if (audioStream.channels !== videoPolicy.audio.channels) failures.push(`audioChannels=${audioStream.channels}`);
    }
  }
  if (failures.length) {
    throw new BenchmarkError(`Composed video failed validation: ${failures.join(', ')}`, { kind: 'infrastructure' });
  }
  return { ...probe, fileSizeBytes: outputSize, frameRate, bitrate, soundtrack: {
    enabled: videoPolicy.audio.enabled,
    title: videoPolicy.audio.title,
    artist: videoPolicy.audio.artist,
    sourcePage: videoPolicy.audio.sourcePage,
    license: videoPolicy.audio.license,
    licenseUrl: videoPolicy.audio.licenseUrl,
    startSeconds: videoPolicy.audio.startSeconds,
    volume: videoPolicy.audio.volume,
  } };
}
