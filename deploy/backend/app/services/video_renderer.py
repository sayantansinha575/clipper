import subprocess
from pathlib import Path
from typing import List, Optional
import cv2
from scenedetect import SceneManager, open_video
from scenedetect.detectors import ContentDetector


def detect_scenes_pyscenedetect(video_path: str, threshold: float = 27.0) -> List[float]:
    video = open_video(video_path)
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=threshold))
    scene_manager.detect_scenes(video)
    return [round(float(s[0].get_seconds()), 2) for s in scene_manager.get_scene_list()]


def detect_subject_x_center(video_path: str, timestamp_sec: float) -> Optional[float]:
    """CPU-capable OpenCV Haar Cascade face center detector with safe center fallback."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None
    try:
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp_sec) * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            return None
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
        if len(faces) == 0:
            return None
        x, _y, w, _h = max(faces, key=lambda f: f[2] * f[3])
        frame_w = frame.shape[1]
        return (x + w / 2.0) / float(frame_w) if frame_w > 0 else None
    finally:
        cap.release()


def render_vertical_clip_ffmpeg(
    source_path: str,
    output_path: str,
    start_time: float,
    end_time: float,
    ass_path: Optional[str] = None,
    width: int = 1080,
    height: int = 1920,
    blurred_bg: bool = True,
) -> Path:
    duration = max(0.5, end_time - start_time)
    post = f"ass='{ass_path}',format=yuv420p" if ass_path else "format=yuv420p"

    cmd = ["ffmpeg", "-y", "-ss", str(start_time), "-i", source_path, "-t", str(duration)]
    if blurred_bg:
        fc = (
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=24:6,eq=brightness=-0.08[bgb];"
            f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[fgs];"
            f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,{post}[vout]"
        )
        cmd += ["-filter_complex", fc, "-map", "[vout]", "-map", "0:a:0?"]
    else:
        cmd += [
            "-vf",
            f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},{post}",
        ]

    cmd += [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        output_path,
    ]
    subprocess.run(cmd, check=True)
    return Path(output_path)
