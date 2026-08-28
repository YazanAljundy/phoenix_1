import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/utils/cloudinary_image.dart';

void main() {
  // A URL in the exact shape backend/src/services/upload.service.js produces:
  // Cloudinary secure_url, a version segment, a folder, no transformation.
  const raw =
      'https://res.cloudinary.com/demo/image/upload/v1699999999/banners/abc123.jpg';

  group('isCloudinaryUrl', () {
    test('true for a Cloudinary /image/upload/ delivery URL', () {
      expect(isCloudinaryUrl(raw), isTrue);
    });

    test('false for null / empty / non-Cloudinary', () {
      expect(isCloudinaryUrl(null), isFalse);
      expect(isCloudinaryUrl(''), isFalse);
      expect(isCloudinaryUrl('https://example.com/pic.png'), isFalse);
      expect(
        isCloudinaryUrl('https://res.cloudinary.com/demo/video/upload/v1/x.mp4'),
        isFalse,
      );
    });
  });

  group('cloudinaryOptimizedUrl', () {
    test('inserts f_auto,q_auto + width + c_limit before the version', () {
      expect(
        cloudinaryOptimizedUrl(raw, width: 300),
        'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_300,c_limit/v1699999999/banners/abc123.jpg',
      );
    });

    test('adds height and keeps c_limit by default (aspect ratio preserved)', () {
      expect(
        cloudinaryOptimizedUrl(raw, width: 300, height: 200),
        'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_300,h_200,c_limit/v1699999999/banners/abc123.jpg',
      );
    });

    test('crop: true switches to c_fill', () {
      expect(
        cloudinaryOptimizedUrl(raw, width: 150, height: 150, crop: true),
        'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_150,h_150,c_fill/v1699999999/banners/abc123.jpg',
      );
    });

    test('no dimensions -> still applies f_auto,q_auto only (no crop mode)', () {
      expect(
        cloudinaryOptimizedUrl(raw),
        'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1699999999/banners/abc123.jpg',
      );
    });

    test('non-Cloudinary URL is returned completely unchanged', () {
      const other = 'https://cdn.example.com/uploads/photo.png';
      expect(cloudinaryOptimizedUrl(other, width: 300), other);
    });

    test('a URL that already carries a transformation is left untouched', () {
      const already =
          'https://res.cloudinary.com/demo/image/upload/w_600,c_fill/v1699999999/banners/abc123.jpg';
      expect(cloudinaryOptimizedUrl(already, width: 300), already);

      const singleParam =
          'https://res.cloudinary.com/demo/image/upload/q_auto/v1/banners/abc.jpg';
      expect(cloudinaryOptimizedUrl(singleParam, width: 300), singleParam);
    });

    test('handles a versionless public id (folder segment first)', () {
      const versionless =
          'https://res.cloudinary.com/demo/image/upload/returns/xyz.jpg';
      expect(
        cloudinaryOptimizedUrl(versionless, width: 128),
        'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_128,c_limit/returns/xyz.jpg',
      );
    });

    test('a bare public id with no folder still works', () {
      const bare =
          'https://res.cloudinary.com/demo/image/upload/v123/abc123.png';
      expect(
        cloudinaryOptimizedUrl(bare, width: 64),
        'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_64,c_limit/v123/abc123.png',
      );
    });

    test('zero / negative dimensions are ignored', () {
      expect(
        cloudinaryOptimizedUrl(raw, width: 0, height: -5),
        'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1699999999/banners/abc123.jpg',
      );
    });

    test('preserves a query string on the URL', () {
      const withQuery = '$raw?_a=cc';
      expect(
        cloudinaryOptimizedUrl(withQuery, width: 300),
        'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_300,c_limit/v1699999999/banners/abc123.jpg?_a=cc',
      );
    });

    test('running it twice does not stack a second transformation', () {
      final once = cloudinaryOptimizedUrl(raw, width: 300);
      final twice = cloudinaryOptimizedUrl(once, width: 800);
      expect(twice, once);
    });
  });
}
