// Invented disks of the demo, shared by the mock services and the capture.

const GiB = 1024 ** 3;
const TiB = 1024 * GiB;
/**
 * Invented disks: one big shared media disk, a 4K disk that fills up fast
 * and the small system disk every container sees. Free space as of now; the
 * capture writes the history that led here.
 */
export const DEMO_DISKS = {
  data: { totalBytes: 16 * TiB, freeBytes: Math.round(3.4 * TiB), perDay: 31 * GiB },
  uhd: { totalBytes: 8 * TiB, freeBytes: 590 * GiB, perDay: 24 * GiB },
  system: { totalBytes: 120 * GiB, freeBytes: 71 * GiB, perDay: 0 },
};
