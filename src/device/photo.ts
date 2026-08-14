import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'

/**
 * Capturing and storing field evidence.
 *
 * On device, photos come from the live camera only — CameraSource.Camera means
 * there is no gallery picker to escape into, which is the whole point of a
 * compliance photo. On web the browser cannot enforce that, so `capture()`
 * falls back to a file input and marks the result as unverified. Development
 * still works; the enforcement only exists in the native build.
 *
 * Every image is downscaled and re-encoded before upload. At roughly 25 photos
 * per rep per day this is the difference between ~200KB and ~4MB per shot, and
 * therefore between a manageable bucket and an expensive one.
 */

const MAX_EDGE_PX = 1600
const JPEG_QUALITY = 0.72

export interface CapturedPhoto {
  blob: Blob
  /** False when the image came from a file picker rather than a live camera. */
  fromLiveCamera: boolean
  width: number
  height: number
}

/** Downscale so the longest edge is at most MAX_EDGE_PX, then re-encode as JPEG. */
async function compress(source: Blob): Promise<CapturedPhoto> {
  const bitmap = await createImageBitmap(source)
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the photo on this device.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  )
  if (!blob) throw new Error('Could not process the photo on this device.')
  return { blob, fromLiveCamera: false, width, height }
}

function pickFile(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment' // a hint on mobile web; not enforceable
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) resolve(file)
      else reject(new Error('No photo was selected.'))
    }
    input.oncancel = () => reject(new Error('No photo was selected.'))
    input.click()
  })
}

/** Take a photo. Live camera on device, file picker on web. */
export async function capture(): Promise<CapturedPhoto> {
  if (!Capacitor.isNativePlatform()) {
    const file = await pickFile()
    return { ...(await compress(file)), fromLiveCamera: false }
  }

  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,   // camera only — no gallery
    allowEditing: false,
    resultType: CameraResultType.Uri,
    quality: 90,
    saveToGallery: false,
  })
  if (!photo.webPath) throw new Error('The camera did not return a photo.')

  const raw = await (await fetch(photo.webPath)).blob()
  return { ...(await compress(raw)), fromLiveCamera: true }
}

export type PhotoKind =
  | 'odometer_start' | 'odometer_end'
  | 'shelf' | 'display_strip' | 'counter' | 'godown'
  | 'expense_bill' | 'other'

/**
 * Upload to `field/{uid}/{sessionId}/{kind}-{timestamp}.jpg`, matching the
 * layout storage.rules is written against. Returns the storage path — store
 * that, not the download URL, since URLs carry tokens and can be regenerated.
 */
export async function upload(
  photo: CapturedPhoto,
  args: { uid: string; sessionId: string; kind: PhotoKind },
): Promise<string> {
  const path = `field/${args.uid}/${args.sessionId}/${args.kind}-${Date.now()}.jpg`
  await uploadBytes(ref(storage, path), photo.blob, {
    contentType: 'image/jpeg',
    customMetadata: {
      kind: args.kind,
      fromLiveCamera: String(photo.fromLiveCamera),
    },
  })
  return path
}

/** Capture and upload in one step. */
export async function captureAndUpload(
  args: { uid: string; sessionId: string; kind: PhotoKind },
): Promise<{ path: string; fromLiveCamera: boolean }> {
  const photo = await capture()
  const path = await upload(photo, args)
  return { path, fromLiveCamera: photo.fromLiveCamera }
}

/** Resolve a stored path to a viewable URL, for the review screens. */
export async function urlFor(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path))
}
