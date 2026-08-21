import { TestBed } from '@angular/core/testing';
import { CameraService } from './camera.service';

/**
 * TestBed unit tests for CameraService. getUserMedia is stubbed so we can drive
 * each permission outcome without a real camera.
 */
describe('CameraService', () => {
  let service: CameraService;
  const originalMediaDevices = Object.getOwnPropertyDescriptor(
    navigator,
    'mediaDevices',
  );

  function setMediaDevices(value: unknown): void {
    Object.defineProperty(navigator, 'mediaDevices', {
      value,
      configurable: true,
    });
  }

  function fakeVideo(): HTMLVideoElement {
    return {
      srcObject: null,
      play: () => Promise.resolve(),
    } as unknown as HTMLVideoElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CameraService);
  });

  afterEach(() => {
    if (originalMediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    }
  });

  it('reports "unsupported" when getUserMedia is unavailable', async () => {
    setMediaDevices(undefined);
    await service.start(fakeVideo());
    expect(service.status()).toBe('unsupported');
    expect(service.error()).toContain('secure origin');
  });

  it('reports "denied" on NotAllowedError', async () => {
    setMediaDevices({
      getUserMedia: () =>
        Promise.reject(new DOMException('nope', 'NotAllowedError')),
    });
    await service.start(fakeVideo());
    expect(service.status()).toBe('denied');
    expect(service.error()).toContain('denied');
  });

  it('reports "error" when no device is found', async () => {
    setMediaDevices({
      getUserMedia: () =>
        Promise.reject(new DOMException('none', 'NotFoundError')),
    });
    await service.start(fakeVideo());
    expect(service.status()).toBe('error');
  });

  it('attaches the stream and reports "granted" on success', async () => {
    const tracks = [{ stop: () => {} }];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    setMediaDevices({ getUserMedia: () => Promise.resolve(stream) });

    const video = fakeVideo();
    await service.start(video);

    expect(service.status()).toBe('granted');
    expect(video.srcObject).toBe(stream);
  });

  it('requests a 640x480 stream', async () => {
    let constraints: MediaStreamConstraints | undefined;
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    setMediaDevices({
      getUserMedia: (c: MediaStreamConstraints) => {
        constraints = c;
        return Promise.resolve(stream);
      },
    });

    await service.start(fakeVideo());

    const video = constraints?.video;
    expect(video).toBeTruthy();
    expect(video).toMatchObject({
      width: { ideal: 640 },
      height: { ideal: 480 },
    });
  });

  it('stops tracks and detaches on stop()', async () => {
    let stopped = false;
    const stream = {
      getTracks: () => [{ stop: () => (stopped = true) }],
    } as unknown as MediaStream;
    setMediaDevices({ getUserMedia: () => Promise.resolve(stream) });

    const video = fakeVideo();
    await service.start(video);
    service.stop(video);

    expect(stopped).toBe(true);
    expect(video.srcObject).toBeNull();
    expect(service.status()).toBe('idle');
  });
});
