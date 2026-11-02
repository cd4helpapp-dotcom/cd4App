// @ts-nocheck
// CD4's logo and a doctor's signature, for pdf-lib documents.
import { CD4_LOGO_PNG_BASE64 } from "./cd4Logo.ts"

const fromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

export const embedCd4Logo = (pdf: any) => pdf.embedPng(fromBase64(CD4_LOGO_PNG_BASE64))

// Uploads are checked in the app, but the bytes decide the format, because the file name can be wrong.
const embedByContent = (pdf: any, bytes: Uint8Array) => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return pdf.embedPng(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return pdf.embedJpg(bytes)
  throw new Error("signature_format_not_supported")
}

export const loadDoctorSignature = async (serviceClient: any, signaturePath: unknown): Promise<Uint8Array | null> => {
  const path = String(signaturePath || "").trim()
  if (!path) return null
  const { data, error } = await serviceClient.storage.from("doctor-kyc").download(path)
  if (error || !data) {
    console.warn("Doctor signature could not be loaded:", error?.message || "empty")
    return null
  }
  return new Uint8Array(await data.arrayBuffer())
}

// Fits the image inside the box, right-aligned on the box's right edge. A bad image must never stop the prescription going out.
export const drawDoctorSignature = async (pdf: any, page: any, bytes: Uint8Array | null, box: { right: number; bottom: number; width: number; height: number }): Promise<boolean> => {
  if (!bytes?.length) return false
  try {
    const image = await embedByContent(pdf, bytes)
    const scale = Math.min(box.width / image.width, box.height / image.height, 1)
    const width = image.width * scale
    const height = image.height * scale
    page.drawImage(image, { x: box.right - width, y: box.bottom, width, height })
    return true
  } catch (error) {
    console.warn("Doctor signature could not be drawn:", error instanceof Error ? error.message : error)
    return false
  }
}
