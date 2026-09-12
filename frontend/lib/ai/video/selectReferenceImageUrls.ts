const MAX_REFERENCE_IMAGES = 3;

export function selectReferenceImageUrls(
  requestedUrls: string[],
  signedPhotoUrls: string[],
): string[] {
  const allowedUrls = new Set(signedPhotoUrls);
  return requestedUrls
    .filter((url) => allowedUrls.has(url))
    .slice(0, MAX_REFERENCE_IMAGES);
}
