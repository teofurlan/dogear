import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest';
import CameraCapture from './CameraCapture.jsx';

describe('CameraCapture', () => {
  let mockTrack;
  let mockStream;
  let originalMediaDevices;
  let originalCreateObjectURL;
  let originalRevokeObjectURL;

  beforeEach(() => {
    mockTrack = {
      kind: 'video',
      stop: vi.fn(),
      enabled: true,
    };
    mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };

    originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
      configurable: true,
      writable: true,
    });

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    });
    HTMLCanvasElement.prototype.toBlob = vi.fn(function(cb, type) {
      cb(new Blob(['fake-image-bytes'], {type: type || 'image/jpeg'}));
    });

    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.HTMLVideoElement.prototype, 'videoWidth', {configurable: true, get: () => 1920});
    Object.defineProperty(window.HTMLVideoElement.prototype, 'videoHeight', {configurable: true, get: () => 1080});

    originalCreateObjectURL = globalThis.URL.createObjectURL;
    originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-preview-url');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
      writable: true,
    });
    globalThis.URL.createObjectURL = originalCreateObjectURL;
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  test('opens rear camera by default with cover guide and accessible shutter', async () => {
    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} guide="cover" />);

    expect(screen.getByRole('dialog', {name: 'Camera'})).toBeInTheDocument();
    expect(screen.getByLabelText('Close camera')).toBeInTheDocument();
    expect(screen.getByLabelText('Flip camera')).toBeInTheDocument();
    expect(screen.getByLabelText('Take photo')).toBeInTheDocument();

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        video: {
          facingMode: {ideal: 'environment'},
          width: {ideal: 1920},
          height: {ideal: 1080},
        },
        audio: false,
      });
    });

    const guide = document.querySelector('.camera-guide-cover');
    expect(guide).toBeInTheDocument();
  });

  test('renders page guide when guide="page"', async () => {
    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} guide="page" />);
    const guide = document.querySelector('.camera-guide-page');
    expect(guide).toBeInTheDocument();
  });

  test('flips camera between environment and user modes and stops previous tracks', async () => {
    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Flip camera'));

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2));
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
      video: {
        facingMode: 'user',
        width: {ideal: 1920},
        height: {ideal: 1080},
      },
      audio: false,
    });

    fireEvent.click(screen.getByLabelText('Flip camera'));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(3));
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
      video: {
        facingMode: {ideal: 'environment'},
        width: {ideal: 1920},
        height: {ideal: 1080},
      },
      audio: false,
    });
  });

  test('takes photo, stops live tracks, shows review with Retake and Use photo', async () => {
    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} guide="cover" />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText('Take photo'));

    expect(await screen.findByRole('button', {name: 'Retake'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Use photo'})).toBeInTheDocument();
    expect(screen.getByAltText('Captured preview')).toHaveAttribute('src', 'blob:mock-preview-url');
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  test('retake restarts camera stream and returns to viewfinder', async () => {
    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Take photo'));
    expect(await screen.findByRole('button', {name: 'Retake'})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Retake'}));

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Take photo')).toBeInTheDocument();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview-url');
  });

  test('a flip while the first camera is still starting leaves no stream running', async () => {
    const first = {getTracks: vi.fn(() => [firstTrack])};
    const firstTrack = {kind: 'video', stop: vi.fn()};
    let resolveFirst;
    navigator.mediaDevices.getUserMedia
      .mockReturnValueOnce(new Promise(resolve => {resolveFirst = resolve;}))
      .mockResolvedValueOnce(mockStream);
    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Flip camera'));
    await waitFor(() => expect(screen.getByLabelText('Take photo')).toBeEnabled());
    resolveFirst(first);
    await waitFor(() => expect(firstTrack.stop).toHaveBeenCalled());
    expect(mockTrack.stop).not.toHaveBeenCalled();
  });

  test('the shutter waits for decoded frames', async () => {
    Object.defineProperty(window.HTMLVideoElement.prototype, 'videoWidth', {configurable: true, get: () => 0});
    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    expect(screen.getByLabelText('Take photo')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Take photo'));
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  });

  test('unmounting during review revokes the preview URL', async () => {
    const {unmount} = render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Take photo')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Take photo'));
    await screen.findByRole('button', {name: 'Use photo'});
    unmount();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview-url');
  });

  test('use photo calls onCapture with JPEG File and stops tracks', async () => {
    const onCapture = vi.fn();
    render(<CameraCapture onCapture={onCapture} onClose={vi.fn()} guide="cover" />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText('Take photo'));
    const useBtn = await screen.findByRole('button', {name: 'Use photo'});
    fireEvent.click(useBtn);

    expect(onCapture).toHaveBeenCalledTimes(1);
    const file = onCapture.mock.calls[0][0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('cover.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview-url');
  });

  test('use photo names file page.jpg when guide="page"', async () => {
    const onCapture = vi.fn();
    render(<CameraCapture onCapture={onCapture} onClose={vi.fn()} guide="page" />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText('Take photo'));
    const useBtn = await screen.findByRole('button', {name: 'Use photo'});
    fireEvent.click(useBtn);

    expect(onCapture).toHaveBeenCalledTimes(1);
    const file = onCapture.mock.calls[0][0];
    expect(file.name).toBe('page.jpg');
  });

  test('close button stops stream and calls onClose', async () => {
    const onClose = vi.fn();
    render(<CameraCapture onCapture={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText('Close camera'));
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape key stops stream and closes camera', async () => {
    const onClose = vi.fn();
    render(<CameraCapture onCapture={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('unmounting stops all tracks', async () => {
    const {unmount} = render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    unmount();
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  test('permission denied invokes onError and onClose with clear message', async () => {
    const notAllowed = new Error('Permission denied');
    notAllowed.name = 'NotAllowedError';
    navigator.mediaDevices.getUserMedia.mockRejectedValue(notAllowed);

    const onError = vi.fn();
    const onClose = vi.fn();
    render(<CameraCapture onCapture={vi.fn()} onClose={onClose} onError={onError} />);

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        'Camera permission was denied. Choose a photo from the gallery instead.'
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  test('missing getUserMedia invokes onError and onClose', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      configurable: true,
      writable: true,
    });

    const onError = vi.fn();
    const onClose = vi.fn();
    render(<CameraCapture onCapture={vi.fn()} onClose={onClose} onError={onError} />);

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        'Camera is not available on this device. Choose a photo from the gallery instead.'
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
