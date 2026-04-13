import sharp from 'sharp';

async function readImageMetadata(buffer) {
  const metadata = await sharp(buffer).metadata();
  const {
    format,
    size,
    width,
    height,
    space,
    channels,
    depth,
    density,
    hasProfile,
    hasAlpha,
    orientation,
    exif: rawExif,
  } = metadata;

  return {
    width: width || null,
    height: height || null,
    exif: JSON.stringify({
      format,
      size,
      width,
      height,
      space,
      channels,
      depth,
      density,
      hasProfile,
      hasAlpha,
      orientation,
      hasExif: !!rawExif,
    }),
  };
}

export { readImageMetadata };
