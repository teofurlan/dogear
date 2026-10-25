import React, {useCallback, useEffect, useRef, useState} from 'react';
import './camera.css';

export default function CameraCapture({onCapture, onClose, onError, guide = 'cover'}) {
  const [facingMode, setFacingMode] = useState('environment');
  const [photo, setPhoto] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const shutterRef = useRef(null);
  const usePhotoRef = useRef(null);
  const mountedRef = useRef(true);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const cleanupPhoto = useCallback(() => {
    if (photo?.url) {
      URL.revokeObjectURL(photo.url);
    }
    setPhoto(null);
  }, [photo]);

  const startCamera = useCallback(async (mode) => {
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia || (typeof window !== 'undefined' && window.isSecureContext === false)) {
      onError?.('Camera is not available on this device. Choose a photo from the gallery instead.');
      onClose?.();
      return;
    }
    try {
      const constraints = {
        video: {
          facingMode: mode === 'user' ? 'user' : {ideal: 'environment'},
          width: {ideal: 1920},
          height: {ideal: 1080}
        },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          // Playback might be interrupted or handled by autoPlay
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const isDenied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      const message = isDenied
        ? 'Camera permission was denied. Choose a photo from the gallery instead.'
        : 'Camera is not available on this device. Choose a photo from the gallery instead.';
      onError?.(message);
      onClose?.();
    }
  }, [onError, onClose, stopStream]);

  useEffect(() => {
    mountedRef.current = true;
    startCamera(facingMode);
    return () => {
      mountedRef.current = false;
      stopStream();
      if (photo?.url) {
        URL.revokeObjectURL(photo.url);
      }
    };
  }, []);

  useEffect(() => {
    if (photo) {
      usePhotoRef.current?.focus();
    } else {
      shutterRef.current?.focus();
    }
  }, [photo]);

  function handleClose() {
    stopStream();
    cleanupPhoto();
    onClose?.();
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      handleClose();
    }
  }

  function flipCamera() {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startCamera(nextMode);
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const width = video.videoWidth || 1920;
    const height = video.videoHeight || 1080;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, width, height);
    }
    const handleBlob = (blob) => {
      if (!mountedRef.current || !blob) return;
      stopStream();
      const url = URL.createObjectURL(blob);
      setPhoto({blob, url});
    };
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(handleBlob, 'image/jpeg', 0.92);
    } else if (typeof canvas.toDataURL === 'function') {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const bin = atob(dataUrl.split(',')[1] || '');
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      handleBlob(new Blob([arr], {type: 'image/jpeg'}));
    }
  }

  function retake() {
    cleanupPhoto();
    startCamera(facingMode);
  }

  function usePhoto() {
    if (!photo?.blob) return;
    const fileName = guide === 'cover' ? 'cover.jpg' : 'page.jpg';
    const file = new File([photo.blob], fileName, {type: 'image/jpeg'});
    stopStream();
    cleanupPhoto();
    onCapture?.(file);
  }

  return <div className="camera-overlay" role="dialog" aria-modal="true" aria-label="Camera" onKeyDown={handleKeyDown}>
    <div className="camera-container">
      <div className="camera-header">
        <button type="button" className="camera-btn-close" aria-label="Close camera" onClick={handleClose}>Close</button>
        {!photo ? <button type="button" className="camera-btn-flip" aria-label="Flip camera" onClick={flipCamera}>Flip</button> : null}
      </div>
      <div className="camera-viewfinder">
        {photo ? (
          <img src={photo.url} alt="Captured preview" className="camera-preview-image" />
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="camera-video" aria-label="Live camera preview" />
            <div className={`camera-guide camera-guide-${guide}`} aria-hidden="true">
              <div className="camera-guide-box" />
            </div>
          </>
        )}
      </div>
      <div className="camera-footer">
        {photo ? (
          <div className="camera-review-actions">
            <button type="button" className="camera-btn-retake" onClick={retake}>Retake</button>
            <button ref={usePhotoRef} type="button" className="camera-btn-use" onClick={usePhoto}>Use photo</button>
          </div>
        ) : (
          <button ref={shutterRef} type="button" className="camera-shutter-button" aria-label="Take photo" onClick={takePhoto}>
            Take photo
          </button>
        )}
      </div>
    </div>
  </div>;
}
