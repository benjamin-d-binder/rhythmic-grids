// Pre3d, a JavaScript software 3d renderer.
// (c) Dean McNamee <dean@gmail.com>, Dec 2008.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.
//
// Here are a few notes about what was involved in making this code fast.
//
// - Being careful about painting The engine works in quads, 4 vertices per
//   face, no restriction on being coplanar, or on triangles.  If we were to
//   work only in triangles, we would have to do twice as many paints and
//   longer sorts, since we would double the polygon count.
//
//   Depending on the underlying rasterization system, strokes can be pretty
//   slow, slower than fills.  This is why overdraw is not a stroke.
//
// - Objects over Arrays
//   Because Arrays always go through the key lookup path (a[0] is a['0']), and
//   there is no way to do a named lookup (like a.0), it is faster to use
//   objects than arrays for fixed size storage.  You can think of this like
//   the difference between a List and Tuple in languages like python.  Modern
//   engines can do a better job accessing named properties, so we represented
//   our data as objects.  Profiling showed a huge difference, keyed lookup
//   used to be the most expensive operation in profiling, taking around ~5%.
//
//   There is also a performance (and convenience) balance betweening object
//   literals and constructor functions.  Small and obvious structures like
//   points have no constructor, and are expected to be created as object
//   literals.  Objects with many properties are created through a constructor.
//
// - Object creation / GC pressure
//   One of the trickiest things about a language like JavaScript is avoiding
//   long GC pauses and object churn.  You can do things like cache and reuse
//   objects, avoid creating extra intermediate objects, etc.  Right now there
//   has been a little bit of work done here, but there is more to be done.
//
// - Flattening
//   It is very tempting as a programmer to write generic routines, for example
//   math functions that could work on either 2d or 3d.  This is convenient,
//   but the caller already knows which they should be using, and the extra
//   overhead for generic routines turned out to be substantial.  Unrolling
//   specialized code makes a big difference, for example an early profile:
//   before:    2.5%    2.5%   Function: subPoints    // old general 2d and 3d
//   after:     0.3%    0.3%   Function: subPoints2d  // fast case 2d
//   after:     0.2%    0.2%   Function: subPoints3d  // fast case 3d
//
// - Don't use new if you don't have to
//   Some profiles showed that new (JSConstructCall) at about ~1%.  These were
//   for code like new Array(size);  Specifically for the Array constructor, it
//   ignores the object created and passed in via new, and returns a different
//   object anyway.  This means 'new Array()' and 'Array()' should be
//   interchangable, and this allows you to avoid the overhead for new.
//
// - Local variable caching
//   In most cases it should be faster to look something up in the local frame
//   than to evaluate the expression / lookup more than once.  In these cases
//   I generally try to cache the variable in a local var.
//
// You might notice that in a few places there is code like:
//   Blah.protype.someMethod = function someMethod() { }
// someMethod is duplicated on the function so that the name of the function
// is not anonymous, and it can be easier to debug and profile.

var Pre3d = (function() {

  // 2D and 3D point / vector / matrix math.  Points and vectors are expected
  // to have an x, y and z (if 3d) property.  It is important to be consistent
  // when creating these objects to allow the JavaScript engine to properly
  // optimize the property access.  Create this as object literals, ex:
  //   var my_2d_point_or_vector = {x: 0, y: 0};
  //   var my_3d_point_or_vector = {x: 0, y: 0, z: 0};
  //
  // There is one convention that might be confusing.  In order to avoid extra
  // object creations, there are some "IP" versions of these functions.  This
  // stands for "in place", and they write the result to one of the arguments.

  function crossProduct(a, b) {
    // a1b2 - a2b1, a2b0 - a0b2, a0b1 - a1b0
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  function dotProduct2d(a, b) {
    return a.x * b.x + a.y * b.y;
  }
  function dotProduct3d(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  // a - b
  function subPoints2d(a, b) {
    return {x: a.x - b.x, y: a.y - b.y};
  }
  function subPoints3d(a, b) {
    return {x: a.x - b.x, y: a.y - b.y, z: a.z - b.z};
  }

  // c = a - b
  function subPoints2dIP(c, a, b) {
    c.x = a.x - b.x;
    c.y = a.y - b.y;
    return c;
  }
  function subPoints3dIP(c, a, b) {
    c.x = a.x - b.x;
    c.y = a.y - b.y;
    c.z = a.z - b.z;
    return c;
  }

  // a + b
  function addPoints2d(a, b) {
    return {x: a.x + b.x, y: a.y + b.y};
  }
  function addPoints3d(a, b) {
    return {x: a.x + b.x, y: a.y + b.y, z: a.z + b.z};
  }

  // c = a + b
  function addPoints2dIP(c, a, b) {
    c.x = a.x + b.x;
    c.y = a.y + b.y;
    return c;
  }
  function addPoints3dIP(c, a, b) {
    c.x = a.x + b.x;
    c.y = a.y + b.y;
    c.z = a.z + b.z;
    return c;
  }

  // a * s
  function mulPoint2d(a, s) {
    return {x: a.x * s, y: a.y * s};
  }
  function mulPoint3d(a, s) {
    return {x: a.x * s, y: a.y * s, z: a.z * s};
  }

  // |a|
  function vecMag2d(a) {
    var ax = a.x, ay = a.y;
    return Math.sqrt(ax * ax + ay * ay);
  }
  function vecMag3d(a) {
    var ax = a.x, ay = a.y, az = a.z;
    return Math.sqrt(ax * ax + ay * ay + az * az);
  }

  // a / |a|
  function unitVector2d(a) {
    return mulPoint2d(a, 1 / vecMag2d(a));
  }
  function unitVector3d(a) {
    return mulPoint3d(a, 1 / vecMag3d(a));
  }

  // Linear interpolation on the line along points (0, |a|) and (1, |b|).  The
  // position |d| is the x coordinate, where 0 is |a| and 1 is |b|.
  function linearInterpolate(a, b, d) {
    return (b-a)*d + a;
  }

  // Linear interpolation on the line along points |a| and |b|.  |d| is the
  // position, where 0 is |a| and 1 is |b|.
  function linearInterpolatePoints3d(a, b, d) {
    return {
      x: (b.x-a.x)*d + a.x,
      y: (b.y-a.y)*d + a.y,
      z: (b.z-a.z)*d + a.z
    }
  }

  // This represents an affine 4x4 matrix, stored as a 3x4 matrix with the last
  // row implied as [0, 0, 0, 1].  This is to avoid generally unneeded work,
  // skipping part of the homogeneous coordinates calculations and the
  // homogeneous divide.  Unlike points, we use a constructor function instead
  // of object literals to ensure map sharing.  The matrix looks like:
  //  e0  e1  e2  e3
  //  e4  e5  e6  e7
  //  e8  e9  e10 e11
  //  0   0   0   1
  function AffineMatrix(e0, e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11) {
    this.e0  = e0;
    this.e1  = e1;
    this.e2  = e2;
    this.e3  = e3;
    this.e4  = e4;
    this.e5  = e5;
    this.e6  = e6;
    this.e7  = e7;
    this.e8  = e8;
    this.e9  = e9;
    this.e10 = e10;
    this.e11 = e11;
  };

  // Matrix multiplication of AffineMatrix |a| x |b|.  This is unrolled,
  // and includes the calculations with the implied last row.
  function multiplyAffine(a, b) {
    // Avoid repeated property lookups by accessing into the local frame.
    var a0 = a.e0, a1 = a.e1, a2 = a.e2, a3 = a.e3, a4 = a.e4, a5 = a.e5;
    var a6 = a.e6, a7 = a.e7, a8 = a.e8, a9 = a.e9, a10 = a.e10, a11 = a.e11;
    var b0 = b.e0, b1 = b.e1, b2 = b.e2, b3 = b.e3, b4 = b.e4, b5 = b.e5;
    var b6 = b.e6, b7 = b.e7, b8 = b.e8, b9 = b.e9, b10 = b.e10, b11 = b.e11;

    return new AffineMatrix(
      a0 * b0 + a1 * b4 + a2 * b8,
      a0 * b1 + a1 * b5 + a2 * b9,
      a0 * b2 + a1 * b6 + a2 * b10,
      a0 * b3 + a1 * b7 + a2 * b11 + a3,
      a4 * b0 + a5 * b4 + a6 * b8,
      a4 * b1 + a5 * b5 + a6 * b9,
      a4 * b2 + a5 * b6 + a6 * b10,
      a4 * b3 + a5 * b7 + a6 * b11 + a7,
      a8 * b0 + a9 * b4 + a10 * b8,
      a8 * b1 + a9 * b5 + a10 * b9,
      a8 * b2 + a9 * b6 + a10 * b10,
      a8 * b3 + a9 * b7 + a10 * b11 + a11
    );
  }

  function makeIdentityAffine() {
    return new AffineMatrix(
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0
    );
  }

  // http://en.wikipedia.org/wiki/Rotation_matrix
  function makeRotateAffineX(theta) {
    var s = Math.sin(theta);
    var c = Math.cos(theta);
    return new AffineMatrix(
      1, 0,  0, 0,
      0, c, -s, 0,
      0, s,  c, 0
    );
  }

  function makeRotateAffineY(theta) {
    var s = Math.sin(theta);
    var c = Math.cos(theta);
    return new AffineMatrix(
       c, 0, s, 0,
       0, 1, 0, 0,
      -s, 0, c, 0
    );
  }

  function makeRotateAffineZ(theta) {
    var s = Math.sin(theta);
    var c = Math.cos(theta);
    return new AffineMatrix(
      c, -s, 0, 0,
      s,  c, 0, 0,
      0,  0, 1, 0
    );
  }

  function makeTranslateAffine(dx, dy, dz) {
    return new AffineMatrix(
      1, 0, 0, dx,
      0, 1, 0, dy,
      0, 0, 1, dz
    );
  }

  function makeScaleAffine(sx, sy, sz) {
    return new AffineMatrix(
      sx,  0,  0, 0,
       0, sy,  0, 0,
       0,  0, sz, 0
    );
  }

  // Return a copy of the affine matrix |m|.
  function dupAffine(m) {
    return new AffineMatrix(
        m.e0, m.e1, m.e2, m.e3,
        m.e4, m.e5, m.e6, m.e7,
        m.e8, m.e9, m.e10, m.e11);
  }

  // Return the transpose of the inverse done via the classical adjoint.  This
  // skips division by the determinant, so vectors transformed by the resulting
  // transform will not retain their original length.
  // Reference: "Transformations of Surface Normal Vectors" by Ken Turkowski.
  function transAdjoint(a) {
    var a0 = a.e0, a1 = a.e1, a2 = a.e2, a4 = a.e4, a5 = a.e5;
    var a6 = a.e6, a8 = a.e8, a9 = a.e9, a10 = a.e10;
    return new AffineMatrix(
      a10 * a5 - a6 * a9,
      a6 * a8 - a4 * a10,
      a4 * a9 - a8 * a5,
      0,
      a2 * a9 - a10 * a1,
      a10 * a0 - a2 * a8,
      a8 * a1 - a0 * a9,
      0,
      a6 * a1 - a2 * a5,
      a4 * a2 - a6 * a0,
      a0 * a5 - a4 * a1,
      0
    );
  }

  // Transform the point |p| by the AffineMatrix |t|.
  function transformPoint(t, p) {
    return {
      x: t.e0 * p.x + t.e1 * p.y + t.e2  * p.z + t.e3,
      y: t.e4 * p.x + t.e5 * p.y + t.e6  * p.z + t.e7,
      z: t.e8 * p.x + t.e9 * p.y + t.e10 * p.z + t.e11
    };
  }

  // A Transform is a convenient wrapper around a AffineMatrix, and it is what
  // will be exposed for most transforms (camera, etc).
  function Transform() {
    this.reset();
  }

  // Reset the transform to the identity matrix.
  Transform.prototype.reset = function() {
    this.m = makeIdentityAffine();
  };

  // TODO(deanm): We are creating two extra objects here.  What would be most
  // effecient is something like multiplyAffineByRotateXIP(this.m), etc.
  Transform.prototype.rotateX = function(theta) {
    this.m =
        multiplyAffine(makeRotateAffineX(theta), this.m);
  };
  Transform.prototype.rotateXPre = function(theta) {
    this.m =
        multiplyAffine(this.m, makeRotateAffineX(theta));
  };

  Transform.prototype.rotateY = function(theta) {
    this.m =
        multiplyAffine(makeRotateAffineY(theta), this.m);
  };
  Transform.prototype.rotateYPre = function(theta) {
    this.m =
        multiplyAffine(this.m, makeRotateAffineY(theta));
  };

  Transform.prototype.rotateZ = function(theta) {
    this.m =
        multiplyAffine(makeRotateAffineZ(theta), this.m);
  };
  Transform.prototype.rotateZPre = function(theta) {
    this.m =
        multiplyAffine(this.m, makeRotateAffineZ(theta));
  };

  Transform.prototype.translate = function(dx, dy, dz) {
    this.m =
        multiplyAffine(makeTranslateAffine(dx, dy, dz), this.m);
  };
  Transform.prototype.translatePre = function(dx, dy, dz) {
    this.m =
        multiplyAffine(this.m, makeTranslateAffine(dx, dy, dz));
  };

  Transform.prototype.scale = function(sx, sy, sz) {
    this.m =
        multiplyAffine(makeScaleAffine(sx, sy, sz), this.m);
  };

  Transform.prototype.scalePre = function(sx, sy, sz) {
    this.m =
        multiplyAffine(this.m, makeScaleAffine(sx, sy, sz));
  };

  Transform.prototype.transformPoint = function(p) {
    return transformPoint(this.m, p);
  };

  Transform.prototype.multTransform = function(t) {
    this.m = multiplyAffine(this.m, t.m);
  };

  Transform.prototype.setDCM = function(u, v, w) {
    var m = this.m;
    m.e0 = u.x; m.e4 = u.y; m.e8 = u.z;
    m.e1 = v.x; m.e5 = v.y; m.e9 = v.z;
    m.e2 = w.x; m.e6 = w.y; m.e10 = w.z;
  };

  Transform.prototype.dup = function() {
    // TODO(deanm): This should be better.
    var tm = new Transform();
    tm.m = dupAffine(this.m);
    return tm;
  };

  // Transform and return a new array of points with transform matrix |t|.
  function transformPoints(t, ps) {
    var il = ps.length;
    var out = Array(il);
    for (var i = 0; i < il; ++i) {
      out[i] = transformPoint(t, ps[i]);
    }
    return out;
  }

  // Average a list of points, returning a new "centroid" point.
  function averagePoints(ps) {
    var avg = {x: 0, y: 0, z: 0};
    for (var i = 0, il = ps.length; i < il; ++i) {
      var p = ps[i];
      avg.x += p.x;
      avg.y += p.y;
      avg.z += p.z;
    }

    // TODO(deanm): 1 divide and 3 multiplies cheaper than 3 divides?
    var f = 1 / il;

    avg.x *= f;
    avg.y *= f;
    avg.z *= f;

    return avg;
  }

  // Push a and b away from each other.  This means that the distance between
  // a and be should be greater, by 2 units, 1 in each direction.
  function pushPoints2dIP(a, b) {
    var vec = unitVector2d(subPoints2d(b, a));
    addPoints2dIP(b, b, vec);
    subPoints2dIP(a, a, vec);
  }

  // RGBA is our simple representation for colors.
  function RGBA(r, g, b, a) {
    this.setRGBA(r, g, b, a);
  };

  RGBA.prototype.setRGBA = function(r, g, b, a) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  };

  RGBA.prototype.setRGB = function(r, g, b) {
    this.setRGBA(r, g, b, 1);
  };

  RGBA.prototype.invert = function() {
    this.r = 1 - this.r;
    this.g = 1 - this.g;
    this.b = 1 - this.b;
  };

  RGBA.prototype.dup = function() {
    return new RGBA(this.r, this.g, this.b, this.a);
  };

  // A QuadFace represents a polygon, either a four sided quad, or sort of a
  // degenerated quad triangle.  Passing null as i3 indicates a triangle.  The
  // QuadFace stores indices, which will generally point into some vertex list
  // that the QuadFace has nothing to do with.  At the annoyance of keeping
  // the data up to date, QuadFace stores a pre-calculated centroid and two
  // normals (two triangles in a quad).  This is an optimization for rendering
  // and procedural operations, and you must set them correctly.
  // NOTE: The front of a QuadFace has vertices in counter-clockwise order.
  function QuadFace(i0, i1, i2, i3) {
    this.i0 = i0;
    this.i1 = i1;
    this.i2 = i2;
    this.i3 = i3;

    this.centroid = null;
    this.normal1 = null;
    this.normal2 = null;
  }

  QuadFace.prototype.isTriangle = function() {
    return (this.i3 === null);
  };

  QuadFace.prototype.setQuad = function(i0, i1, i2, i3) {
    this.i0 = i0;
    this.i1 = i1;
    this.i2 = i2;
    this.i3 = i3;
  };

  QuadFace.prototype.setTriangle = function(i0, i1, i2) {
    this.i0 = i0;
    this.i1 = i1;
    this.i2 = i2;
    this.i3 = null;
  };

  // A Shape represents a mesh, a collection of QuadFaces.  The Shape stores
  // a list of all vertices (so they can be shared across QuadFaces), and the
  // QuadFaces store indices into this list.
  //
  // All properties of shapes are meant to be public, so access them directly.
  function Shape() {
    // Array of 3d points, our vertices.
    this.vertices = [ ];
    // Array of QuadFaces, the indices will point into |vertices|.
    this.quads = [ ];
  }

  // A curve represents a bezier curve, either quadratic or cubic.  It is
  // the QuadFace equivalent for 3d paths.  Like QuadFace, the points are
  // indices into a Path.
  function Curve(ep, c0, c1) {
    this.ep = ep;  // End point.
    this.c0 = c0;  // Control point.
    this.c1 = c1;  // Control point.
  }

  Curve.prototype.isQuadratic = function() {
    return (this.c1 === null);
  };

  Curve.prototype.setQuadratic = function(ep, c0) {
    this.ep = ep;
    this.c0 = c0;
    this.c1 = null;
  };

  Curve.prototype.setCubic = function(ep, c0, c1) {
    this.ep = ep;
    this.c0 = c0;
    this.c1 = c1;
  };

  // A path is a collection of Curves.  The path starts implicitly at
  // (0, 0, 0), and then continues along each curve, each piece of curve
  // continuing where the last left off, forming a continuous path.
  function Path() {
    // An array of points.
    this.points = [ ];
    // The Curves index into points.
    this.curves = [ ];
    // Optional starting point.  If this is null, the path will start at the
    // origin (0, 0, 0).  Otherwise this is an index into points.
    this.starting_point = null;
  }

  // A camera is represented by a transform, and a focal length.
  function Camera() {
    this.transform = new Transform();
    this.focal_length = 1;
  }

  // TextureInfo is used to describe when and how a QuadFace should be
  // textured.  |image| should be something drawable by <canvas>, like a <img>
  // or another <canvas> element.  This also stores the 2d uv coordinates.
  function TextureInfo() {
    this.image = null;
    this.u0 = null;
    this.v0 = null;
    this.u1 = null;
    this.v1 = null;
    this.u2 = null;
    this.v2 = null;
    this.u3 = null;
    this.v3 = null;
  };

  // This is the guts, drawing 3d onto a <canvas> element.  This class does a
  // few things:
  //   - Manage the render state, things like colors, transforms, camera, etc.
  //   - Manage a buffer of quads to be drawn.  When you add something to be
  //     drawn, it will use the render state at the time it was added.  The
  //     pattern is generally to add some things, modify the render state, add
  //     some more things, change some colors, add some more, than draw.
  //     NOTE: The reason for buffering is having to z-sort.  We do not perform
  //     the rasterization, so something like a z-buffer isn't applicable.
  //   - Draw the buffer of things to be drawn.  This will do a background
  //     color paint, render all of the buffered quads to the screen, etc.
  //
  // NOTE: Drawing does not clear the buffered quads, so you can keep drawing
  // and adding more things and drawing, etc.  You must explicitly empty the
  // things to be drawn when you want to start fresh.
  //
  // NOTE: Some things, such as colors, as copied into the buffered state as
  // a reference.  If you want to update the color on the render state, you
  // should replace it with a new color.  Modifying the original will modify
  // it for objects that have already been buffered.  Same holds for textures.
  function Renderer(canvas_element) {
    // Should we z-sort for painters back to front.
    this.perform_z_sorting = true;
    // Should we inflate quads to visually cover up antialiasing gaps.
    this.draw_overdraw = true;
    // Should we skip backface culling.
    this.draw_backfaces = false;

    this.texture = null;
    this.fill_rgba = new RGBA(1, 0, 0, 1);

    this.stroke_rgba = null;

    this.normal1_rgba = null;
    this.normal2_rgba = null;

    this.canvas = canvas_element;
    this.ctx = canvas_element.getContext('2d');

    // The camera.
    this.camera = new Camera();

    // Object to world coordinates transformation.
    this.transform = new Transform();

    // Used for pushTransform and popTransform.  The current transform is
    // always r.transform, and the stack holds anything else.  Internal.
    this.transform_stack_ = [ ];

    // A callback before a QuadFace is processed during bufferShape.  This
    // allows you to change the render state per-quad, and also to skip a quad
    // by returning true from the callback.  For example:
    //   renderer.quad_callback = function(quad_face, quad_index, shape) {
    //     renderer.fill_rgba.r = quad_index * 40;
    //     return false;  // Don't skip this quad.
    //   };
    this.quad_callback = null;

    // Internals, don't access me.
    this.width_  = canvas_element.width;
    this.height_ = canvas_element.height;
    this.scale_ = this.height_ / 2;
    this.xoff_ = this.width_ / 2;

    this.buffered_quads_ = null;
    this.emptyBuffer();

    // We prefer these functions as they avoid the CSS color parsing path, but
    // if they're not available (Firefox), then augment the ctx to fall back.
    if (this.ctx.setStrokeColor == null) {
      this.ctx.setStrokeColor = function setStrokeColor(r, g, b, a) {
        var rgba = [
          Math.floor(r * 255),
          Math.floor(g * 255),
          Math.floor(b * 255),
          a
        ];
        this.strokeStyle = 'rgba(' + rgba.join(',') + ')';
      }
    }
    if (this.ctx.setFillColor == null) {
      this.ctx.setFillColor = function setFillColor(r, g, b, a) {
        var rgba = [
          Math.floor(r * 255),
          Math.floor(g * 255),
          Math.floor(b * 255),
          a
        ];
        this.fillStyle = 'rgba(' + rgba.join(',') + ')';
      }
    }
  }

  Renderer.prototype.pushTransform = function() {
    this.transform_stack_.push(this.transform.dup());
  };

  Renderer.prototype.popTransform = function() {
    // If the stack is empty we'll end up with undefined as the transform.
    this.transform = this.transform_stack_.pop();
  };

  Renderer.prototype.emptyBuffer = function() {
    this.buffered_quads_ = [ ];
  };

  // TODO(deanm): Pull the project stuff off the class if possible.

  // http://en.wikipedia.org/wiki/Pinhole_camera_model
  //
  // Project the 3d point |p| to a point in 2d.
  // Takes the current focal_length_ in account.
  Renderer.prototype.projectPointToCanvas = function projectPointToCanvas(p) {
    // We're looking down the z-axis in the negative direction...
    var v = this.camera.focal_length / -p.z;
    var scale = this.scale_;
    // Map the height to -1 .. 1, and the width to maintain aspect.
    return {x: p.x * v * scale + this.xoff_,
            y: p.y * v * -scale + scale};
  };

  // Project a 3d point onto the 2d canvas surface (pixel coordinates).
  // Takes the current focal_length in account.
  // TODO: flatten this calculation so we don't need make a method call.
  Renderer.prototype.projectPointsToCanvas =
      function projectPointsToCanvas(ps) {
    var il = ps.length;
    var out = Array(il);
    for (var i = 0; i < il; ++i) {
      out[i] = this.projectPointToCanvas(ps[i]);
    }
    return out;
  };

  Renderer.prototype.projectQuadFaceToCanvasIP = function(qf) {
    qf.i0 = this.projectPointToCanvas(qf.i0);
    qf.i1 = this.projectPointToCanvas(qf.i1);
    qf.i2 = this.projectPointToCanvas(qf.i2);
    if (!qf.isTriangle())
      qf.i3 = this.projectPointToCanvas(qf.i3);
    return qf;
  };

  // Textured triangle drawing by Thatcher Ulrich.  Draw a triangle portion of
  // an image, with the source (uv coordinates) mapped to screen x/y
  // coordinates.  A transformation matrix for this mapping is calculated, so
  // that the image |im| is rotated / scaled / etc to map to the x/y dest.  A
  // clipping mask is applied when drawing |im|, so only the triangle is drawn.
  function drawCanvasTexturedTriangle(ctx, im,
                                      x0, y0, x1, y1, x2, y2,
                                      sx0, sy0, sx1, sy1, sx2, sy2) {
    ctx.save();

    // Clip the output to the on-screen triangle boundaries.
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();

    var denom =
        sx0 * (sy2 - sy1) -
        sx1 * sy2 +
        sx2 * sy1 +
        (sx1 - sx2) * sy0;

    var m11 = - (
        sy0 * (x2 - x1) -
        sy1 * x2 +
        sy2 * x1 +
        (sy1 - sy2) * x0) / denom;
    var m12 = (
        sy1 * y2 +
        sy0 * (y1 - y2) -
        sy2 * y1 +
        (sy2 - sy1) * y0) / denom;
    var m21 = (
        sx0 * (x2 - x1) -
        sx1 * x2 +
        sx2 * x1 +
        (sx1 - sx2) * x0) / denom;
    var m22 = - (
        sx1 * y2 +
        sx0 * (y1 - y2) -
        sx2 * y1 +
        (sx2 - sx1) * y0) / denom;
    var dx = (
        sx0 * (sy2 * x1 - sy1 * x2) +
        sy0 * (sx1 * x2 - sx2 * x1) +
        (sx2 * sy1 - sx1 * sy2) * x0) / denom;
    var dy = (
        sx0 * (sy2 * y1 - sy1 * y2) +
        sy0 * (sx1 * y2 - sx2 * y1) +
        (sx2 * sy1 - sx1 * sy2) * y0) / denom;

    ctx.transform(m11, m12, m21, m22, dx, dy);

    // Draw the whole image.  Transform and clip will map it onto the
    // correct output triangle.
    //
    // TODO(tulrich): figure out if drawImage goes faster if we specify the
    // rectangle that bounds the source coords.
    ctx.drawImage(im, 0, 0);
    ctx.restore();
  }

  // A unit vector down the z-axis.
  var g_z_axis_vector = {x: 0, y: 0, z: 1};

  // Put a shape into the draw buffer, transforming it by the current camera,
  // applying any current render state, etc.
  Renderer.prototype.bufferShape = function bufferShape(shape) {
    var draw_backfaces = this.draw_backfaces;
    var quad_callback = this.quad_callback;

    // Our vertex transformation matrix.
    var t = multiplyAffine(this.camera.transform.m,
                           this.transform.m);
    // Our normal transformation matrix.
    var tn = transAdjoint(t);

    // We are transforming the points even if we decide it's back facing.
    // We could just transform the normal, and then only transform the
    // points if we needed it.  But then you need to check to see if the
    // point was already translated to avoid duplicating work, or just
    // always calculate it and duplicate the work.  Not sure what's best...
    var world_vertices = transformPoints(t, shape.vertices);
    var quads = shape.quads;

    for (var j = 0, jl = shape.quads.length; j < jl; ++j) {
      var qf = quads[j];

      // Call the optional quad callback.  This gives a chance to update the
      // render state per-quad, before we emit into the buffered quads.  It
      // also gives the earliest chance to skip a quad.
      if (quad_callback !== null && quad_callback(qf, j, shape) === true)
        continue;

      var centroid = transformPoint(t, qf.centroid);

      // Cull quads that are behind the camera.
      // TODO(deanm): this should probably involve the focal point?
      if (centroid.z >= -1)
        continue;

      // NOTE: The transform tn isn't going to always keep the vectors unit
      // length, so n1 and n2 should be normalized if needed.
      // We unit vector n1 (for lighting, etc).
      var n1 = unitVector3d(transformPoint(tn, qf.normal1));
      var n2 = transformPoint(tn, qf.normal2);

      // Backface culling.  I'm not sure the exact right way to do this, but
      // this seems to look ok, following the eye from the origin.  We look
      // at the normals of the triangulated quad, and make sure at least one
      // is point towards the camera...
      if (draw_backfaces !== true &&
          dotProduct3d(centroid, n1) > 0 &&
          dotProduct3d(centroid, n2) > 0) {
        continue;
      }

      // Lighting intensity is just based on just one of the normals pointing
      // towards the camera.  Should do something better here someday...
      var intensity = dotProduct3d(g_z_axis_vector, n1);
      if (intensity < 0)
        intensity = 0;

      // We map the quad into world coordinates, and also replace the indices
      // with the actual points.
      var world_qf;

      if (qf.isTriangle() === true) {
        world_qf = new QuadFace(
          world_vertices[qf.i0],
          world_vertices[qf.i1],
          world_vertices[qf.i2],
          null
        );
      } else {
        world_qf = new QuadFace(
          world_vertices[qf.i0],
          world_vertices[qf.i1],
          world_vertices[qf.i2],
          world_vertices[qf.i3]
        );
      }

      world_qf.centroid = centroid;
      world_qf.normal1 = n1;
      world_qf.normal2 = n2;

      var obj = {
        qf: world_qf,
        intensity: intensity,
        draw_overdraw: this.draw_overdraw,
        texture: this.texture,
        fill_rgba: this.fill_rgba,
        stroke_rgba: this.stroke_rgba,
        normal1_rgba: this.normal1_rgba,
        normal2_rgba: this.normal2_rgba
      };

      this.buffered_quads_.push(obj);
    }
  };

  // Sort an array of points by z axis.
  function zSorter(x, y) {
    return x.qf.centroid.z - y.qf.centroid.z;
  }

  // Paint the background.  You should setup the fill color on ctx.
  Renderer.prototype.drawBackground = function() {
    this.ctx.fillRect(0, 0, this.width_, this.height_);
  };

  // Clear the background so the canvas is transparent.
  Renderer.prototype.clearBackground = function() {
    this.ctx.clearRect(0, 0, this.width_, this.height_);
  };

  Renderer.prototype.drawBuffer = function drawBuffer() {
    var ctx = this.ctx;

    var all_quads = this.buffered_quads_;
    var num_quads = all_quads.length;

    // Sort the quads by z-index for painters algorithm :(
    // We're looking down the z-axis in the negative direction, so we want
    // to paint the most negative z quads first.
    if (this.perform_z_sorting === true)
      all_quads.sort(zSorter);

    for (var j = 0; j < num_quads; ++j) {
      var obj = all_quads[j];
      var qf = obj.qf;

      this.projectQuadFaceToCanvasIP(qf);

      var is_triangle = qf.isTriangle();

      if (obj.draw_overdraw === true) {
        // Unfortunately when we fill with canvas, we can get some gap looking
        // things on the edges between quads.  One possible solution is to
        // stroke the path, but this turns out to be really expensive.  Instead
        // we try to increase the area of the quad.  Each edge pushes its
        // vertices away from each other.  This is sort of similar in concept
        // to the builtin canvas shadow support (shadowOffsetX, etc).  However,
        // Chrome doesn't support shadows correctly now.  It does in trunk, but
        // using shadows to fill the gaps looks awful, and also seems slower.

        pushPoints2dIP(qf.i0, qf.i1);
        pushPoints2dIP(qf.i1, qf.i2);
        if (is_triangle === true) {
          pushPoints2dIP(qf.i2, qf.i0);
        } else {  // Quad.
          pushPoints2dIP(qf.i2, qf.i3);
          pushPoints2dIP(qf.i3, qf.i0);
        }
      }

      // Create our quad as a <canvas> path.
      ctx.beginPath();
      ctx.moveTo(qf.i0.x, qf.i0.y);
      ctx.lineTo(qf.i1.x, qf.i1.y);
      ctx.lineTo(qf.i2.x, qf.i2.y);
      if (is_triangle !== true)
        ctx.lineTo(qf.i3.x, qf.i3.y);
      // Don't bother closing it unless we need to.

      // Fill...
      var frgba = obj.fill_rgba;
      if (frgba !== null) {
        var iy = obj.intensity;
        ctx.setFillColor(frgba.r * iy, frgba.g * iy, frgba.b * iy, frgba.a);
        ctx.fill();
      }

      // Texturing...
      var texture = obj.texture;
      if (texture !== null) {
        drawCanvasTexturedTriangle(ctx, texture.image,
          qf.i0.x, qf.i0.y, qf.i1.x, qf.i1.y, qf.i2.x, qf.i2.y,
          texture.u0, texture.v0, texture.u1, texture.v1,
          texture.u2, texture.v2);
        if (!is_triangle) {
          drawCanvasTexturedTriangle(ctx, texture.image,
            qf.i0.x, qf.i0.y, qf.i2.x, qf.i2.y, qf.i3.x, qf.i3.y,
            texture.u0, texture.v0, texture.u2, texture.v2,
            texture.u3, texture.v3);
        }
      }

      // Stroke...
      var srgba = obj.stroke_rgba;
      if (srgba !== null) {
        ctx.closePath();
        ctx.setStrokeColor(srgba.r, srgba.g, srgba.b, srgba.a);
        ctx.stroke();
      }

      // Normal lines (stroke)...
      var n1r = obj.normal1_rgba;
      var n2r = obj.normal2_rgba;
      if (n1r !== null) {
        ctx.setStrokeColor(n1r.r, n1r.g, n1r.b, n1r.a);
        var screen_centroid = this.projectPointToCanvas(qf.centroid);
        var screen_point = this.projectPointToCanvas(
            addPoints3d(qf.centroid, unitVector3d(qf.normal1)));
        ctx.beginPath();
        ctx.moveTo(screen_centroid.x, screen_centroid.y);
        ctx.lineTo(screen_point.x, screen_point.y);
        ctx.stroke();
      }
      if (n2r !== null) {
        ctx.setStrokeColor(n2r.r, n2r.g, n2r.b, n2r.a);
        var screen_centroid = this.projectPointToCanvas(qf.centroid);
        var screen_point = this.projectPointToCanvas(
            addPoints3d(qf.centroid, unitVector3d(qf.normal2)));
        ctx.beginPath();
        ctx.moveTo(screen_centroid.x, screen_centroid.y);
        ctx.lineTo(screen_point.x, screen_point.y);
        ctx.stroke();
      }
    }

    return num_quads;
  }

  // Draw a Path.  There is no buffering, because there is no culling or
  // z-sorting.  There is currently no filling, paths are only stroked.  To
  // control the render state, you should modify ctx directly, and set whatever
  // properties you want (stroke color, etc).  The drawing happens immediately.
  Renderer.prototype.drawPath = function drawPath(path, opts) {
    var ctx = this.ctx;
    opts = opts || { };

    var t = multiplyAffine(this.camera.transform.m,
                           this.transform.m);

    var screen_points = this.projectPointsToCanvas(
        transformPoints(t, path.points));

    // Start the path at (0, 0, 0) unless there is an explicit starting point.
    var start_point = (path.starting_point === null ?
        this.projectPointToCanvas(transformPoint(t, {x: 0, y: 0, z: 0})) :
        screen_points[path.starting_point]);

    ctx.beginPath();
    ctx.moveTo(start_point.x, start_point.y);

    var curves = path.curves;
    for (var j = 0, jl = curves.length; j < jl; ++j) {
      var curve = curves[j];

      if (curve.isQuadratic() === true) {
        var c0 = screen_points[curve.c0];
        var ep = screen_points[curve.ep];
        ctx.quadraticCurveTo(c0.x, c0.y, ep.x, ep.y);
      } else {
        var c0 = screen_points[curve.c0];
        var c1 = screen_points[curve.c1];
        var ep = screen_points[curve.ep];
        ctx.bezierCurveTo(c0.x, c0.y, c1.x, c1.y, ep.x, ep.y);
      }
    }

    // We've connected all our Curves into a <canvas> path, now draw it.
    if (opts.fill === true) {
      ctx.fill();
    } else {
      ctx.stroke();
    }
  };

  return {
    RGBA: RGBA,
    AffineMatrix: AffineMatrix,
    Transform: Transform,
    QuadFace: QuadFace,
    Shape: Shape,
    Curve: Curve,
    Path: Path,
    Camera: Camera,
    TextureInfo: TextureInfo,
    Renderer: Renderer,
    Math: {
      crossProduct: crossProduct,
      dotProduct2d: dotProduct2d,
      dotProduct3d: dotProduct3d,
      subPoints2d: subPoints2d,
      subPoints3d: subPoints3d,
      addPoints2d: addPoints2d,
      addPoints3d: addPoints3d,
      mulPoint2d: mulPoint2d,
      mulPoint3d: mulPoint3d,
      vecMag2d: vecMag2d,
      vecMag3d: vecMag3d,
      unitVector2d: unitVector2d,
      unitVector3d: unitVector3d,
      linearInterpolate: linearInterpolate,
      linearInterpolatePoints3d: linearInterpolatePoints3d,
      averagePoints: averagePoints
    }
  };
})();
// Pre3d, a JavaScript software 3d renderer.
// (c) Dean McNamee <dean@gmail.com>, Dec 2008.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.
//
// This file implements helpers related to creating / modifying Shapes.  Some
// routines exist for basic primitives (box, sphere, etc), along with some
// routines for procedural shape operations (extrude, subdivide, etc).
//
// The procedural operations were inspired from the demoscene.  A lot of the
// ideas are based on similar concepts in Farbrausch's werkkzeug1.

Pre3d.ShapeUtils = (function() {

  // TODO(deanm): Having to import all the math like this is a bummer.
  var crossProduct = Pre3d.Math.crossProduct;
  var dotProduct2d = Pre3d.Math.dotProduct2d;
  var dotProduct3d = Pre3d.Math.dotProduct3d;
  var subPoints2d = Pre3d.Math.subPoints2d;
  var subPoints3d = Pre3d.Math.subPoints3d;
  var addPoints2d = Pre3d.Math.addPoints2d;
  var addPoints3d = Pre3d.Math.addPoints3d;
  var mulPoint2d = Pre3d.Math.mulPoint2d;
  var mulPoint3d = Pre3d.Math.mulPoint3d;
  var vecMag2d = Pre3d.Math.vecMag2d;
  var vecMag3d = Pre3d.Math.vecMag3d;
  var unitVector2d = Pre3d.Math.unitVector2d;
  var unitVector3d = Pre3d.Math.unitVector3d;
  var linearInterpolate = Pre3d.Math.linearInterpolate;
  var linearInterpolatePoints3d = Pre3d.Math.linearInterpolatePoints3d;
  var averagePoints = Pre3d.Math.averagePoints;

  var k2PI = Math.PI * 2;

  // averagePoints() specialized for averaging 2 points.
  function averagePoints2(a, b) {
    return {
      x: (a.x + b.x) * 0.5,
      y: (a.y + b.y) * 0.5,
      z: (a.z + b.z) * 0.5
    };
  }

  // Rebuild the pre-computed "metadata", for the Shape |shape|.  This
  // calculates the centroids and normal vectors for each QuadFace.
  function rebuildMeta(shape) {
    var quads = shape.quads;
    var num_quads = quads.length;
    var vertices = shape.vertices;

    // TODO: It's possible we could save some work here, we could mark the
    // faces "dirty" which need their centroid or normal recomputed.  Right now
    // if we do an operation on a single face, we rebuild all of them.  A
    // simple scheme would be to track any writes to a QuadFace, and to set
    // centroid / normal1 / normal2 to null.  This would also prevent bugs
    // where you forget to call rebuildMeta() and used stale metadata.

    for (var i = 0; i < num_quads; ++i) {
      var qf = quads[i];

      var centroid;
      var n1, n2;

      var vert0 = vertices[qf.i0];
      var vert1 = vertices[qf.i1];
      var vert2 = vertices[qf.i2];
      var vec01 = subPoints3d(vert1, vert0);
      var vec02 = subPoints3d(vert2, vert0);
      var n1 = crossProduct(vec01, vec02);

      if (qf.isTriangle()) {
        n2 = n1;
        centroid = averagePoints([vert0, vert1, vert2]);
      } else {
        var vert3 = vertices[qf.i3];
        var vec03 = subPoints3d(vert3, vert0);
        n2 = crossProduct(vec02, vec03);
        centroid = averagePoints([vert0, vert1, vert2, vert3]);
      }

      qf.centroid = centroid;
      qf.normal1 = n1;
      qf.normal2 = n2;
    }

    return shape;
  }

  // Convert any quad faces into two triangle faces.  After triangulation,
  // |shape| should only consist of triangles.
  function triangulate(shape) {
    var quads = shape.quads;
    var num_quads = quads.length;
    for (var i = 0; i < num_quads; ++i) {
      var qf = quads[i];
      if (qf.isTriangle())
        continue;

      // TODO(deanm): Should we follow some clockwise rule here?
      var newtri = new Pre3d.QuadFace(qf.i0, qf.i2, qf.i3, null);
      // Convert the original quad into a triangle.
      qf.i3 = null;
      // Add the new triangle to the list of faces.
      quads.push(newtri);
    }
    rebuildMeta(shape);
    return shape;
  }

  // Call |func| for each face of |shape|.  The callback |func| should return
  // false to continue iteration, or true to stop.  For example:
  //   forEachFace(shape, function(quad_face, quad_index, shape) {
  //     return false;
  //   });
  function forEachFace(shape, func) {
    var quads = shape.quads;
    for (var i = 0, il = quads.length; i < il; ++i) {
      if (func(quads[i], i, shape) === true)
        break;
    }
    return shape;
  }

  function forEachVertex(shape, func) {
    var vertices = shape.vertices;
    for (var i = 0, il = vertices.length; i < il; ++i) {
      if (func(vertices[i], i, shape) === true)
        break;
    }
    return shape;
  }

  function makePlane(p1, p2, p3, p4) {
    var s = new Pre3d.Shape();
    s.vertices = [p1, p2, p3, p4];
    s.quads = [new Pre3d.QuadFace(0, 1, 2, 3)];
    rebuildMeta(s);
    return s;
  }

  // Make a box with width (x) |w|, height (y) |h|, and depth (z) |d|.
  function makeBox(w, h, d) {
    var s = new Pre3d.Shape();
    s.vertices = [
      {x:  w, y:  h, z: -d},  // 0
      {x:  w, y:  h, z:  d},  // 1
      {x:  w, y: -h, z:  d},  // 2
      {x:  w, y: -h, z: -d},  // 3
      {x: -w, y:  h, z: -d},  // 4
      {x: -w, y:  h, z:  d},  // 5
      {x: -w, y: -h, z:  d},  // 6
      {x: -w, y: -h, z: -d}   // 7
    ];

    //    4 -- 0
    //   /|   /|     +y
    //  5 -- 1 |      |__ +x
    //  | 7 -|-3     /
    //  |/   |/    +z
    //  6 -- 2

    s.quads = [
      new Pre3d.QuadFace(0, 1, 2, 3),  // Right side
      new Pre3d.QuadFace(1, 5, 6, 2),  // Front side
      new Pre3d.QuadFace(5, 4, 7, 6),  // Left side
      new Pre3d.QuadFace(4, 0, 3, 7),  // Back side
      new Pre3d.QuadFace(0, 4, 5, 1),  // Top side
      new Pre3d.QuadFace(2, 6, 7, 3)   // Bottom side
    ];

    rebuildMeta(s);

    return s;
  }
  
  // make tesseract vertices with phase and width
  function makeTesseractVertices(phase){
    var whd = 1;
    var pi = Math.PI;
    // 1. Create periodZ and periodXY
    // periodZ shold be a period function with period 2PI
    // and range between [-1, 1] and looks like:
    // -1        1        3
    //      0         2
    var periodZ = function(phase){
        var phase = phase % (2 * pi);
        var correction = function(phase) { return - Math.sin(2 * phase - pi); }
        return phase > pi / 2 && phase < pi * 3 / 2  
                ?   Math.sin(phase) + 1/3 * correction(phase)
                :   Math.sin(phase)
    };
    // constants for x and y directions
    var l = whd / 2;
    var h = whd;
    var a = (h - l) / 2;
    var b = (h + l) / 2;
    var periodXY = function(phase) {
            return a * Math.sin(phase + pi / 2) + b;
        }
    
    // 2. Create all 16 Vertices   
    // Cache Four unrendundtnt points: 4*2 array 
    var FourP = [
        {'xy': periodXY(phase + 7 * pi / 4), 'z' : periodZ(phase + 7 * pi / 4)}, // 0
        {'xy': periodXY(phase + pi / 4), 'z' : periodZ(phase + pi / 4)}, // 1
        {'xy': periodXY(phase + 3 * pi / 4), 'z' : periodZ(phase + 3 * pi / 4)}, // 9
        {'xy': periodXY(phase + 5 * pi / 4), 'z' : periodZ(phase + 5 * pi / 4)}, // 8
    ];
    // phase = 0 is the midpoint of 0 and 1
    // when phase increase, 0,1,9,8 rotate like:
    //  ---->----
    //  |       |
    //  8       0
    //  |       |
    //  9       1
    //  ----<----
    return [
        {'x': FourP[0].xy, 'y': FourP[0].xy, 'z': FourP[0].z}, //0
        {'x': FourP[1].xy, 'y': FourP[1].xy, 'z': FourP[1].z}, //1
        {'x': FourP[1].xy, 'y': - FourP[1].xy, 'z': FourP[1].z}, //2
        {'x': FourP[0].xy, 'y': - FourP[0].xy, 'z': FourP[0].z}, //3
        
        {'x': - FourP[0].xy, 'y': FourP[0].xy, 'z': FourP[0].z}, //4
        {'x': - FourP[1].xy, 'y': FourP[1].xy, 'z': FourP[1].z}, //5
        {'x': - FourP[1].xy, 'y': - FourP[1].xy, 'z': FourP[1].z}, //6
        {'x': - FourP[0].xy, 'y': - FourP[0].xy, 'z': FourP[0].z}, //7
        
        {'x': FourP[3].xy, 'y': FourP[3].xy, 'z': FourP[3].z}, //8
        {'x': FourP[2].xy, 'y': FourP[2].xy, 'z': FourP[2].z}, //9
        {'x': FourP[2].xy, 'y': - FourP[2].xy, 'z': FourP[2].z}, //10
        {'x': FourP[3].xy, 'y': - FourP[3].xy, 'z': FourP[3].z}, //11
        
        {'x': - FourP[3].xy, 'y': FourP[3].xy, 'z': FourP[3].z}, //12
        {'x': - FourP[2].xy, 'y': FourP[2].xy, 'z': FourP[2].z}, //13
        {'x': - FourP[2].xy, 'y': - FourP[2].xy, 'z': FourP[2].z}, //14
        {'x': - FourP[3].xy, 'y': - FourP[3].xy, 'z': FourP[3].z}, //15
        ];
    
  }
  
  // make a Tesseract by whd and phase
  function makeTesseract(whd, phase) {
    var s = new Pre3d.Shape();
    s.vertices = makeTesseractVertices(whd, phase);

    //    4 -- 0
    //   /|   /|     +y
    //  5 -- 1 |      |__ +x
    //  | 7 -|-3     /
    //  |/   |/    +z
    //  6 -- 2

    s.quads = [
      new Pre3d.QuadFace(0, 1, 2, 3),  // Right side
      new Pre3d.QuadFace(1, 5, 6, 2),  // Front side
      new Pre3d.QuadFace(5, 4, 7, 6),  // Left side
      new Pre3d.QuadFace(4, 0, 3, 7),  // Back side
      new Pre3d.QuadFace(0, 4, 5, 1),  // Top side
      new Pre3d.QuadFace(2, 6, 7, 3),  // Bottom side
      
      new Pre3d.QuadFace(8,  9,  10, 11),  // Right side
      new Pre3d.QuadFace(9,  13, 14, 10),  // Front side
      new Pre3d.QuadFace(13, 12, 15, 14),  // Left side
      new Pre3d.QuadFace(12, 8,  11, 15),  // Back side
      new Pre3d.QuadFace(8,  12, 13, 9),   // Top side
      new Pre3d.QuadFace(10, 14, 15, 11),  // Bottom side
      
      new Pre3d.QuadFace(0, 1, 9, 8),   //Right Up
      new Pre3d.QuadFace(11, 10, 2, 3), //Right Down
      new Pre3d.QuadFace(1, 5, 13, 9),  //Front Up
      new Pre3d.QuadFace(10, 14, 6, 2), //Front Down
      new Pre3d.QuadFace(5, 4, 12, 13), //Left Up
      new Pre3d.QuadFace(14, 15, 7, 6), //Left Down
      new Pre3d.QuadFace(4, 0, 8, 12 ), //Back Up
      new Pre3d.QuadFace(15, 11, 3, 7), //Back Down
      new Pre3d.QuadFace(1, 2, 10, 9 ), //Right Front
      new Pre3d.QuadFace(0, 3, 11, 8 ), //Right Back
      new Pre3d.QuadFace(5, 6, 14, 13), //Left Front
      new Pre3d.QuadFace(4, 7, 15, 12), //Left Back
     
    ];
    
    s = complement(s);
    
    rebuildMeta(s);

    return s;
  }
  
  // Make a cube with width, height, and depth |whd|.
  function makeCube(whd) {
    return makeBox(whd, whd, whd);
  }
    
  function makeBoxWithHole(w, h, d, hw, hh) {
    var s = new Pre3d.Shape();
    s.vertices = [
      {x:  w, y:  h, z: -d},  // 0
      {x:  w, y:  h, z:  d},  // 1
      {x:  w, y: -h, z:  d},  // 2
      {x:  w, y: -h, z: -d},  // 3
      {x: -w, y:  h, z: -d},  // 4
      {x: -w, y:  h, z:  d},  // 5
      {x: -w, y: -h, z:  d},  // 6
      {x: -w, y: -h, z: -d},  // 7

      // The front new points ...
      {x: hw, y:   h, z: d},  // 8
      {x:  w, y:  hh, z: d},  // 9
      {x: hw, y:  hh, z: d},  // 10
      {x: hw, y:  -h, z: d},  // 11
      {x:  w, y: -hh, z: d},  // 12
      {x: hw, y: -hh, z: d},  // 13

      {x: -hw, y:   h, z: d},  // 14
      {x:  -w, y:  hh, z: d},  // 15
      {x: -hw, y:  hh, z: d},  // 16
      {x: -hw, y:  -h, z: d},  // 17
      {x:  -w, y: -hh, z: d},  // 18
      {x: -hw, y: -hh, z: d},  // 19

      // The back new points ...
      {x: hw, y:   h, z: -d},  // 20
      {x:  w, y:  hh, z: -d},  // 21
      {x: hw, y:  hh, z: -d},  // 22
      {x: hw, y:  -h, z: -d},  // 23
      {x:  w, y: -hh, z: -d},  // 24
      {x: hw, y: -hh, z: -d},  // 25

      {x: -hw, y:   h, z: -d},  // 26
      {x: -w,  y:  hh, z: -d},  // 27
      {x: -hw, y:  hh, z: -d},  // 28
      {x: -hw, y:  -h, z: -d},  // 29
      {x: -w,  y: -hh, z: -d},  // 30
      {x: -hw, y: -hh, z: -d}   // 31
    ];

    //                        Front               Back (looking from front)
    //    4 -   - 0           05  14  08  01      04  26  20  00
    //   /|      /|
    //  5 -   - 1 |           15  16--10  09      27  28--22  21
    //  | 7 -   |-3               |////|              |////|
    //  |/      |/            18  19--13  12      30  31--25  24
    //  6 -   - 2
    //                        06  17  11  02      07  29  23  03

    s.quads = [
      // Front side
      new Pre3d.QuadFace( 1,  8, 10,  9),
      new Pre3d.QuadFace( 8, 14, 16, 10),
      new Pre3d.QuadFace(14,  5, 15, 16),
      new Pre3d.QuadFace(16, 15, 18, 19),
      new Pre3d.QuadFace(19, 18,  6, 17),
      new Pre3d.QuadFace(13, 19, 17, 11),
      new Pre3d.QuadFace(12, 13, 11,  2),
      new Pre3d.QuadFace( 9, 10, 13, 12),
      // Back side
      new Pre3d.QuadFace( 4, 26, 28, 27),
      new Pre3d.QuadFace(26, 20, 22, 28),
      new Pre3d.QuadFace(20,  0, 21, 22),
      new Pre3d.QuadFace(22, 21, 24, 25),
      new Pre3d.QuadFace(25, 24,  3, 23),
      new Pre3d.QuadFace(31, 25, 23, 29),
      new Pre3d.QuadFace(30, 31, 29,  7),
      new Pre3d.QuadFace(27, 28, 31, 30),
      // The hole
      new Pre3d.QuadFace(10, 16, 28, 22),
      new Pre3d.QuadFace(19, 31, 28, 16),
      new Pre3d.QuadFace(13, 25, 31, 19),
      new Pre3d.QuadFace(10, 22, 25, 13),
      // Bottom side
      new Pre3d.QuadFace( 6,  7, 29, 17),
      new Pre3d.QuadFace(17, 29, 23, 11),
      new Pre3d.QuadFace(11, 23,  3,  2),
      // Right side
      new Pre3d.QuadFace( 1,  9, 21,  0),
      new Pre3d.QuadFace( 9, 12, 24, 21),
      new Pre3d.QuadFace(12,  2,  3, 24),
      // Left side
      new Pre3d.QuadFace( 5,  4, 27, 15),
      new Pre3d.QuadFace(15, 27, 30, 18),
      new Pre3d.QuadFace(18, 30,  7,  6),
      // Top side
      new Pre3d.QuadFace(14, 26,  4,  5),
      new Pre3d.QuadFace( 8, 20, 26, 14),
      new Pre3d.QuadFace( 1,  0, 20,  8)
    ];

    rebuildMeta(s);
    return s;
  }

  // Tessellate a spherical parametric equation.
  // (two extras are for zenith and azimuth).  There will be |tess_x| vertices
  // along the X-axis.  It is centered on the Y-axis.  It has a radius |r|.
  // The implementation is probably still a bit convulted.  We just handle the
  // middle points like a grid, and special case zenith/aximuth, since we want
  // them to share a vertex anyway.  The math is pretty much standard spherical
  // coordinates, except that we map {x, y, z} -> {z, x, y}.  |tess_x| is phi,
  // and |tess_y| is theta.
  function makeSphericalShape(f, tess_x, tess_y) {
    // TODO(deanm): Preallocate the arrays to the final size.
    var vertices = [ ];
    var quads = [ ];

    // We walk theta 0 .. PI and phi from 0 .. 2PI.
    var theta_step = Math.PI / (tess_y + 1);
    var phi_step = (k2PI) / tess_x;

    // Create all of the vertices for the middle grid portion.
    for (var i = 0, theta = theta_step;
         i < tess_y;
         ++i, theta += theta_step) {  // theta
      for (var j = 0; j < tess_x; ++j) {  // phi
        vertices.push(f(theta, phi_step * j));
      }
    }

    // Generate the quads for the middle grid portion.
    for (var i = 0; i < tess_y-1; ++i) {
      var stride = i * tess_x;
      for (var j = 0; j < tess_x; ++j) {
        var n = (j + 1) % tess_x;
        quads.push(new Pre3d.QuadFace(
          stride + j,
          stride + tess_x + j,
          stride + tess_x + n,
          stride + n
        ));
      }
    }

    // Special case the zenith / azimuth (top / bottom) portion of triangles.
    // We make triangles (degenerated quads).
    var last_row = vertices.length - tess_x;
    var top_p_i = vertices.length;
    var bot_p_i = top_p_i + 1;
    vertices.push(f(0, 0));
    vertices.push(f(Math.PI, 0));

    for (var i = 0; i < tess_x; ++i) {
      // Top triangles...
      quads.push(new Pre3d.QuadFace(
        top_p_i,
        i,
        ((i + 1) % tess_x),
        null
      ));
      // Bottom triangles...
      quads.push(new Pre3d.QuadFace(
        bot_p_i,
        last_row + ((i + 2) % tess_x),
        last_row + ((i + 1) % tess_x),
        null
      ));
    }

    var s = new Pre3d.Shape();
    s.vertices = vertices;
    s.quads = quads;
    rebuildMeta(s);
    return s;
  }

  function makeOctahedron() {
    var s = new Pre3d.Shape();
    s.vertices = [
     {x: -1, y:  0, z:  0},  // 0
     {x:  0, y:  0, z:  1},  // 1
     {x:  1, y:  0, z:  0},  // 2
     {x:  0, y:  0, z: -1},  // 3
     {x:  0, y:  1, z:  0},  // 4
     {x:  0, y: -1, z:  0}   // 5
    ];
    // Top 4 triangles: 5 0 1, 5 1 2, 5 2 3, 5 3 0
    // Bottom 4 triangles: 0 5 1, 1 5 2, 2 5 3, 3 5 0
    quads = Array(8);
    for (var i = 0; i < 4; ++i) {
      var i2 = (i + 1) & 3;
      quads[i*2] = new Pre3d.QuadFace(4, i, i2, null);
      quads[i*2+1] = new Pre3d.QuadFace(i, 5, i2, null);
    }

    s.quads = quads;
    Pre3d.ShapeUtils.rebuildMeta(s);
    return s;
  }

  // Tessellate a sphere.  There will be |tess_y| + 2 vertices along the Y-axis
  // (two extras are for zenith and azimuth).  There will be |tess_x| vertices
  // along the X-axis.  It is centered on the Y-axis.  It has a radius |r|.
  // The implementation is probably still a bit convulted.  We just handle the
  // middle points like a grid, and special case zenith/aximuth, since we want
  // them to share a vertex anyway.  The math is pretty much standard spherical
  // coordinates, except that we map {x, y, z} -> {z, x, y}.  |tess_x| is phi,
  // and |tess_y| is theta.
  // TODO(deanm): This code could definitely be more efficent.
  function makeSphere(r, tess_x, tess_y) {
    return makeSphericalShape(function(theta, phi) {
        return {
          x: r * Math.sin(theta) * Math.sin(phi),
          y: r * Math.cos(theta),
          z: r * Math.sin(theta) * Math.cos(phi)
        };
    }, tess_x, tess_y);
  }

  // Smooth a Shape by averaging the vertices / faces.  This is something like
  // Catmull-Clark, but without the proper weighting.  The |m| argument is the
  // amount to smooth, between 0 and 1, 0 being no smoothing.
  function averageSmooth(shape, m) {
    // TODO(deanm): Remove this old compat code for calling without arguments.
    if (m === void(0))
      m = 1;

    var vertices = shape.vertices;
    var psl = vertices.length;
    var new_ps = Array(psl);

    // Build a connection mapping of vertex_index -> [ quad indexes ]
    var connections = Array(psl);
    for (var i = 0; i < psl; ++i)
      connections[i] = [ ];

    for (var i = 0, il = shape.quads.length; i < il; ++i) {
      var qf = shape.quads[i];
      connections[qf.i0].push(i);
      connections[qf.i1].push(i);
      connections[qf.i2].push(i);
      if (!qf.isTriangle())
        connections[qf.i3].push(i);
    }

    // For every vertex, average the centroids of the faces it's a part of.
    for (var i = 0, il = vertices.length; i < il; ++i) {
      var cs = connections[i];
      var avg = {x: 0, y: 0, z: 0};

      // Sum together the centroids of each face.
      for (var j = 0, jl = cs.length; j < jl; ++j) {
        var quad = shape.quads[cs[j]];
        var p1 = vertices[quad.i0];
        var p2 = vertices[quad.i1];
        var p3 = vertices[quad.i2];
        var p4 = vertices[quad.i3];
        // The centroid.  TODO(deanm) can't shape just come from the QuadFace?
        // That would handle triangles better and avoid some duplication.
        avg.x += (p1.x + p2.x + p3.x + p4.x) / 4;
        avg.y += (p1.y + p2.y + p3.y + p4.y) / 4;
        avg.z += (p1.z + p2.z + p3.z + p4.z) / 4;
        // TODO combine all the div / 4 into one divide?
      }

      // We summed up all of the centroids, take the average for our new point.
      var f = 1 / jl;
      avg.x *= f;
      avg.y *= f;
      avg.z *= f;

      // Interpolate between the average and the original based on |m|.
      new_ps[i] = linearInterpolatePoints3d(vertices[i], avg, m);
    }

    shape.vertices = new_ps;

    rebuildMeta(shape);
    return shape;
  }

  // Small utility function like Array.prototype.map.  Return a new array
  // based on the result of the function on a current array.
  function arrayMap(arr, func) {
    var out = Array(arr.length);
    for (var i = 0, il = arr.length; i < il; ++i) {
      out[i] = func(arr[i], i, arr);
    }
    return out;
  }

  // Divide each face of a Shape into 4 equal new faces.
  // TODO(deanm): Better document, doesn't support triangles, etc.
  function linearSubdivide(shape) {
    var num_quads = shape.quads.length;

    var share_points = { };

    for (var i = 0; i < num_quads; ++i) {
      var quad = shape.quads[i];

      var i0 = quad.i0;
      var i1 = quad.i1;
      var i2 = quad.i2;
      var i3 = quad.i3;

      var p0 = shape.vertices[i0];
      var p1 = shape.vertices[i1];
      var p2 = shape.vertices[i2];
      var p3 = shape.vertices[i3];

      //  p0   p1      p0  n0  p1
      //           ->  n3  n4  n1
      //  p3   p2      p3  n2  p2

      // We end up with an array of vertex indices of the centroids of each
      // side of the quad and the middle centroid.  We start with the vertex
      // indices that should be averaged.  We cache centroids to make sure that
      // we share vertices instead of creating two on top of each other.
      var ni = [
        [i0, i1].sort(),
        [i1, i2].sort(),
        [i2, i3].sort(),
        [i3, i0].sort(),
        [i0, i1, i2, i3].sort()
      ];

      for (var j = 0, jl = ni.length; j < jl; ++j) {
        var ps = ni[j];
        var key = ps.join('-');
        var centroid_index = share_points[key];
        if (centroid_index === undefined) {  // hasn't been seen before
          centroid_index = shape.vertices.length;
          var s = shape;
          shape.vertices.push(averagePoints(
              arrayMap(ps, function(x) { return s.vertices[x]; })));
          share_points[key] = centroid_index;
        }

        ni[j] = centroid_index;
      }

      // New quads ...
      var q0 = new Pre3d.QuadFace(   i0, ni[0], ni[4], ni[3]);
      var q1 = new Pre3d.QuadFace(ni[0],    i1, ni[1], ni[4]);
      var q2 = new Pre3d.QuadFace(ni[4], ni[1],    i2, ni[2]);
      var q3 = new Pre3d.QuadFace(ni[3], ni[4], ni[2],    i3);

      shape.quads[i] = q0;
      shape.quads.push(q1);
      shape.quads.push(q2);
      shape.quads.push(q3);
    }

    rebuildMeta(shape);
    return shape;
  }

  // Divide each triangle of a Shape into 4 new triangle faces.  This is done
  // by taking the mid point of each edge, and creating 4 new triangles.  You
  // can visualize it by inscribing a new upside-down triangle within the
  // current triangle, which then defines 4 new sub-triangles.
  function linearSubdivideTri(shape) {
    var num_tris = shape.quads.length;
    var share_points = { };

    for (var i = 0; i < num_tris; ++i) {
      var tri = shape.quads[i];

      var i0 = tri.i0;
      var i1 = tri.i1;
      var i2 = tri.i2;

      var p0 = shape.vertices[i0];
      var p1 = shape.vertices[i1];
      var p2 = shape.vertices[i2];

      //     p0                 p0
      //              ->      n0  n2
      // p1      p2         p1  n1  p2

      // We end up with an array of vertex indices of the centroids of each
      // side of the triangle.  We start with the vertex indices that should be
      // averaged.  We cache centroids to make sure that we share vertices
      // instead of creating two on top of each other.
      var ni = [
        [i0, i1].sort(),
        [i1, i2].sort(),
        [i2, i0].sort(),
      ];

      for (var j = 0, jl = ni.length; j < jl; ++j) {
        var ps = ni[j];
        var key = ps.join('-');
        var centroid_index = share_points[key];
        if (centroid_index === undefined) {  // hasn't been seen before
          centroid_index = shape.vertices.length;
          var s = shape;
          shape.vertices.push(averagePoints(
              arrayMap(ps, function(x) { return s.vertices[x]; })));
          share_points[key] = centroid_index;
        }

        ni[j] = centroid_index;
      }

      // New triangles ...
      var q0 = new Pre3d.QuadFace(   i0, ni[0], ni[2], null);
      var q1 = new Pre3d.QuadFace(ni[0],    i1, ni[1], null);
      var q2 = new Pre3d.QuadFace(ni[2], ni[1],    i2, null);
      var q3 = new Pre3d.QuadFace(ni[0], ni[1], ni[2], null);

      shape.quads[i] = q0;
      shape.quads.push(q1);
      shape.quads.push(q2);
      shape.quads.push(q3);
    }

    rebuildMeta(shape);
    return shape;
  }

  // Detach all of the faces from each other.  Basically this just duplicates
  // all of the vertices for each face, so a vertex is not shared across faces.
  function explodeFaces(shape) {
    var quads = shape.quads;
    var num_quads = quads.length;
    var verts = shape.vertices;
    var new_verts = [ ];
    for (var i = 0; i < num_quads; ++i) {
      var q = quads[i];
      var pos = new_verts.length;
      new_verts.push({x: verts[q.i0].x, y: verts[q.i0].y, z: verts[q.i0].z});
      new_verts.push({x: verts[q.i1].x, y: verts[q.i1].y, z: verts[q.i1].z});
      new_verts.push({x: verts[q.i2].x, y: verts[q.i2].y, z: verts[q.i2].z});
      q.i0 = pos;
      q.i1 = pos + 1;
      q.i2 = pos + 2;
      if (q.isTriangle() !== true) {
        new_verts.push({x: verts[q.i3].x, y: verts[q.i3].y, z: verts[q.i3].z});
        q.i3 = pos + 3;
      }
    }
    shape.vertices = new_verts;
    return shape;
  }

  // The Extruder implements extruding faces of a Shape.  The class mostly
  // exists as a place to hold all of the extrusion parameters.  The properties
  // are meant to be private, please use the getter/setter APIs.
  function Extruder() {
    // The total distance to extrude, if |count| > 1, then each segment will
    // just be a portion of the distance, and together they will be |distance|.
    this.distance_ = 1.0;
    // The number of segments / steps to perform.  This is can be different
    // than just running extrude multiple times, since we only operate on the
    // originally faces, not our newly inserted faces.
    this.count_ = 1;
    // Selection mechanism.  Access these through the selection APIs.
    this.selector_ = null;
    this.selectAll();

    // TODO(deanm): Need a bunch more settings, controlling which normal the
    // extrusion is performed along, etc.

    // Set scale and rotation.  These are public, you can access them directly.
    // TODO(deanm): It would be great to use a Transform here, but there are
    // a few problems.  Translate doesn't make sense, so it is not really an
    // affine.  The real problem is that we need to interpolate across the
    // values, having them in a matrix is not helpful.
    this.scale = {x: 1, y: 1, z: 1};
    this.rotate = {x: 0, y: 0, z: 0};
  }

  // Selection APIs, control which faces are extruded.
  Extruder.prototype.selectAll = function() {
    this.selector_ = function(shape, vertex_index) { return true; };
  };

  // Select faces based on the function select_func.  For example:
  //   extruder.selectCustom(function(shape, quad_index) {
  //     return quad_index == 0;
  //   });
  // The above would select only the first face for extrusion.
  Extruder.prototype.selectCustom = function(select_func) {
    this.selector_ = select_func;
  };

  Extruder.prototype.distance = function() {
    return this.distance_;
  };
  Extruder.prototype.set_distance = function(d) {
    this.distance_ = d;
  };

  Extruder.prototype.count = function() {
    return this.count_;
  };
  Extruder.prototype.set_count = function(c) {
    this.count_ = c;
  };

  Extruder.prototype.extrude = function extrude(shape) {
    var distance = this.distance();
    var count = this.count();

    var rx = this.rotate.x;
    var ry = this.rotate.y;
    var rz = this.rotate.z;
    var sx = this.scale.x;
    var sy = this.scale.y;
    var sz = this.scale.z;

    var vertices = shape.vertices;
    var quads = shape.quads;

    var faces = [ ];
    for (var i = 0, il = quads.length; i < il; ++i) {
      if (this.selector_(shape, i))
        faces.push(i);
    }

    for (var i = 0, il = faces.length; i < il; ++i) {
      // This is the index of the original face.  It will eventually be
      // replaced with the last iteration's outside face.
      var face_index = faces[i];
      // As we proceed down a count, we always need to connect to the newest
      // new face.  We start |quad| as the original face, and it will be
      // modified (in place) for each iteration, and then the next iteration
      // will connect back to the previous iteration, etc.
      var qf = quads[face_index];
      var original_cent = qf.centroid;

      // This is the surface normal, used to project out the new face.  It
      // will be rotated, but never scaled.  It should be a unit vector.
      var surface_normal = unitVector3d(addPoints3d(qf.normal1, qf.normal2));

      var is_triangle = qf.isTriangle();

      // These are the normals inside the face, from the centroid out to the
      // vertices.  They will be rotated and scaled to create the new faces.
      var inner_normal0 = subPoints3d(vertices[qf.i0], original_cent);
      var inner_normal1 = subPoints3d(vertices[qf.i1], original_cent);
      var inner_normal2 = subPoints3d(vertices[qf.i2], original_cent);
      if (is_triangle !== true) {
        var inner_normal3 = subPoints3d(vertices[qf.i3], original_cent);
      }

      for (var z = 0; z < count; ++z) {
        var m = (z + 1) / count;

        var t = new Pre3d.Transform();
        t.rotateX(rx * m);
        t.rotateY(ry * m);
        t.rotateZ(rz * m);

        // For our new point, we simply want to rotate the original normal
        // proportional to how many steps we're at.  Then we want to just scale
        // it out based on our steps, and add it to the original centorid.
        var new_cent = addPoints3d(original_cent,
          mulPoint3d(t.transformPoint(surface_normal), m * distance));

        // We multiplied the centroid, which should not have been affected by
        // the scale.  Now we want to scale the inner face normals.
        t.scalePre(
          linearInterpolate(1, sx, m),
          linearInterpolate(1, sy, m),
          linearInterpolate(1, sz, m));

        var index_before = vertices.length;

        vertices.push(addPoints3d(new_cent, t.transformPoint(inner_normal0)));
        vertices.push(addPoints3d(new_cent, t.transformPoint(inner_normal1)));
        vertices.push(addPoints3d(new_cent, t.transformPoint(inner_normal2)));
        if (is_triangle !== true) {
          vertices.push(
              addPoints3d(new_cent, t.transformPoint(inner_normal3)));
        }

        // Add the new faces.  These faces will always be quads, even if we
        // extruded a triangle.  We will have 3 or 4 new side faces.
        quads.push(new Pre3d.QuadFace(
            qf.i1,
            index_before + 1,
            index_before,
            qf.i0));
        quads.push(new Pre3d.QuadFace(
            qf.i2,
            index_before + 2,
            index_before + 1,
            qf.i1));

        if (is_triangle === true) {
          quads.push(new Pre3d.QuadFace(
              qf.i0,
              index_before,
              index_before + 2,
              qf.i2));
        } else {
          quads.push(new Pre3d.QuadFace(
              qf.i3,
              index_before + 3,
              index_before + 2,
              qf.i2));
          quads.push(new Pre3d.QuadFace(
              qf.i0,
              index_before,
              index_before + 3,
              qf.i3));
        }

        // Update (in place) the original face with the new extruded vertices.
        qf.i0 = index_before;
        qf.i1 = index_before + 1;
        qf.i2 = index_before + 2;
        if (is_triangle !== true)
          qf.i3 = index_before + 3;
      }
    }

    rebuildMeta(shape);  // Compute all the new normals, etc.
  };
  
  // For each QuadFace in a shape, create a complementary one facing
  // the opposite direction so that we can see the same QuadFace at
  // any angle
  function complement(shape) {
    var s = new Pre3d.Shape();
    
    s.vertices = shape.vertices;
    
    var oldQuads = shape.quads;
    // reverse the order of each quad to get complementary quad
    var complementQuads = [];
    oldQuads.forEach(function(quad, index, quads){
            complementQuads.push(new Pre3d.QuadFace(quad.i3, quad.i2, quad.i1, quad.i0));
        });
    s.quads = oldQuads.concat(complementQuads);

    rebuildMeta(s);

    return s;
  }
  
  
  // rotate Tesseract, take in a Tesseract shape and a phase,
  // output the rotated Tesseract.
  function rotateTesseract(shape, phase){
    var s = new Pre3d.Shape();
    s.vertices = makeTesseractVertices(phase);
    s.quads = shape.quads;
    
    rebuildMeta(s);
    
    return s;
  }
  
  return {
    rebuildMeta: rebuildMeta,
    triangulate: triangulate,
    forEachFace: forEachFace,
    forEachVertex: forEachVertex,

    makePlane: makePlane,
    makeCube: makeCube,
    makeTesseract: makeTesseract,
    makeBox: makeBox,
    makeBoxWithHole: makeBoxWithHole,
    makeSphericalShape: makeSphericalShape,
    makeSphere: makeSphere,
    makeOctahedron: makeOctahedron,

    averageSmooth: averageSmooth,
    linearSubdivide: linearSubdivide,
    linearSubdivideTri: linearSubdivideTri,
    explodeFaces: explodeFaces,
    complement: complement,
    rotateTesseract: rotateTesseract,

    Extruder: Extruder
  };
})();
/**
  This library rewrites the Canvas2D "measureText" function
  so that it returns a more complete metrics object.

  Author: Mike "Pomax" Kamermans
**/
(function(){
  var NAME = "FontMetrics Library"
  var VERSION = "1-2011.0927.1431";
  var debug = false;

  // if there is no getComputedStyle, this library won't work.
  if(!document.defaultView.getComputedStyle) {
    throw("ERROR: 'document.defaultView.getComputedStyle' not found. This library only works in browsers that can report computed CSS values.");
  }

  // store the old text metrics function on the Canvas2D prototype
  CanvasRenderingContext2D.prototype.measureTextWidth = CanvasRenderingContext2D.prototype.measureText;

  /**
   *  shortcut function for getting computed CSS values
   */
  var getCSSValue = function(element, property) {
    return document.defaultView.getComputedStyle(element,null).getPropertyValue(property);
  };

  // debug function
  var show = function(canvas, ctx, xstart, w, h, metrics)
  {
    document.body.appendChild(canvas);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';

    ctx.beginPath();
    ctx.moveTo(xstart,0);
    ctx.lineTo(xstart,h);
    ctx.closePath();
    ctx.stroke(); 

    ctx.beginPath();
    ctx.moveTo(xstart+metrics.bounds.maxx,0);
    ctx.lineTo(xstart+metrics.bounds.maxx,h);
    ctx.closePath();
    ctx.stroke(); 

    ctx.beginPath();
    ctx.moveTo(0,h/2-metrics.ascent);
    ctx.lineTo(w,h/2-metrics.ascent);
    ctx.closePath();
    ctx.stroke(); 

    ctx.beginPath();
    ctx.moveTo(0,h/2+metrics.descent);
    ctx.lineTo(w,h/2+metrics.descent);
    ctx.closePath();
    ctx.stroke();
  }

  /**
   * The new text metrics function
   */
  CanvasRenderingContext2D.prototype.measureText = function(textstring) {
    var metrics = this.measureTextWidth(textstring);
        fontFamily = getCSSValue(this.canvas,"font-family"),
        fontSize = getCSSValue(this.canvas,"font-size").replace("px","");
        metrics.fontsize = fontSize;
    var canvas = document.createElement("canvas");
    var padding = 100;
    canvas.width = metrics.width + padding;
    canvas.height = 3*fontSize;
    canvas.style.opacity = 1;
    canvas.style.fontFamily = fontFamily;
    canvas.style.fontSize = fontSize;
    var ctx = canvas.getContext("2d");
    ctx.font = fontSize + "px " + fontFamily;

    // for text lead values, we meaure a multiline text container.
    var leadDiv = document.createElement("div");
    leadDiv.style.position = "absolute";
    leadDiv.style.opacity = 0;
    leadDiv.style.font = fontSize + "px " + fontFamily;
    leadDiv.innerHTML = textstring + "<br/>" + textstring;
    document.body.appendChild(leadDiv);

    var w = canvas.width,
        h = canvas.height,
        baseline = h/2;

    // Set all canvas pixeldata values to 255, with all the content
    // data being 0. This lets us scan for data[i] != 255.
    ctx.fillStyle = "white";
    ctx.fillRect(-1, -1, w+2, h+2);
    ctx.fillStyle = "black";
    ctx.fillText(textstring, padding/2, baseline);
    var pixelData = ctx.getImageData(0, 0, w, h).data;

    // canvas pixel data is w*4 by h*4, because R, G, B and A are separate,
    // consecutive values in the array, rather than stored as 32 bit ints.
    var i = 0,
        w4 = w * 4,
        len = pixelData.length;

    // Finding the ascent uses a normal, forward scanline
    while (++i < len && pixelData[i] === 255) {}
    var ascent = (i/w4)|0;

    // Finding the descent uses a reverse scanline
    i = len - 1;
    while (--i > 0 && pixelData[i] === 255) {}
    var descent = (i/w4)|0;

    // find the min-x coordinate
    for(i = 0; i<len && pixelData[i] === 255; ) {
      i += w4;
      if(i>=len) { i = (i-len) + 4; }}
    var minx = ((i%w4)/4) | 0;

    // find the max-x coordinate
    var step = 1;
    for(i = len-3; i>=0 && pixelData[i] === 255; ) {
      i -= w4;
      if(i<0) { i = (len - 3) - (step++)*4; }}
    var maxx = ((i%w4)/4) + 1 | 0;

    // set font metrics
    metrics.ascent = (baseline - ascent);
    metrics.descent = (descent - baseline);
    metrics.bounds = { minx: minx - (padding/2),
                       maxx: maxx - (padding/2),
                       miny: 0,
                       maxy: descent-ascent };
    metrics.height = 1+(descent - ascent);
                       
    // make some initial guess at the text leading (using the standard TeX ratio)
    metrics.leading = 1.2 * fontSize;

    // then we try to get the real value from the browser
    var leadDivHeight = getCSSValue(leadDiv,"height");
    leadDivHeight = leadDivHeight.replace("px","");
    if (leadDivHeight >= fontSize * 2) { metrics.leading = (leadDivHeight/2) | 0; }
    document.body.removeChild(leadDiv); 

    // show the canvas and bounds if required
    if(debug){show(canvas, ctx, 50, w, h, metrics);}

    return metrics;
  };
}());
var font = (function () {
    var test_string = 'mmmmmmmmmwwwwwww';
    var test_font = '"Comic Sans MS"';
    var notInstalledWidth = 0;
    var testbed = null;
    var guid = 0;
    
    return {
        // must be called when the dom is ready
        setup : function () {
            if ($('#fontInstalledTest').length) return;

            $('head').append('<' + 'style> #fontInstalledTest, #fontTestBed { position: absolute; left: -9999px; top: 0; visibility: hidden; } #fontInstalledTest { font-size: 50px!important; font-family: ' + test_font + ';}</' + 'style>');
            
            
            $('body').append('<div id="fontTestBed"></div>').append('<span id="fontInstalledTest" class="fonttest">' + test_string + '</span>');
            testbed = $('#fontTestBed');
            notInstalledWidth = $('#fontInstalledTest').width();
        },
        
        isInstalled : function(font) {
            guid++;
        
            var style = '<' + 'style id="fonttestStyle"> #fonttest' + guid + ' { font-size: 50px!important; font-family: ' + font + ', ' + test_font + '; } <' + '/style>';
            
            $('head').find('#fonttestStyle').remove().end().append(style);
            testbed.empty().append('<span id="fonttest' + guid + '" class="fonttest">' + test_string + '</span>');
                        
            return (testbed.find('span').width() != notInstalledWidth);
        }
    };
})();
/**
 * JavaScript code to detect available availability of a
 * particular font in a browser using JavaScript and CSS.
 *
 * Author : Lalit Patel
 * Website: http://www.lalit.org/lab/javascript-css-font-detect/
 * License: Apache Software License 2.0
 *          http://www.apache.org/licenses/LICENSE-2.0
 * Version: 0.15 (21 Sep 2009)
 *          Changed comparision font to default from sans-default-default,
 *          as in FF3.0 font of child element didn't fallback
 *          to parent element if the font is missing.
 * Version: 0.2 (04 Mar 2012)
 *          Comparing font against all the 3 generic font families ie,
 *          'monospace', 'sans-serif' and 'sans'. If it doesn't match all 3
 *          then that font is 100% not available in the system
 * Version: 0.3 (24 Mar 2012)
 *          Replaced sans with serif in the list of baseFonts
 */

/**
 * Usage: d = new Detector();
 *        d.detect('font name');
 */
var Detector = function() {
    // a font will be compared against all the three default fonts.
    // and if it doesn't match all 3 then that font is not available.
    var baseFonts = ['monospace', 'sans-serif', 'serif'];

    //we use m or w because these two characters take up the maximum width.
    // And we use a LLi so that the same matching fonts can get separated
    var testString = "mmmmmmmmmmlli";

    //we test using 72px font size, we may use any size. I guess larger the better.
    var testSize = '72px';

    var h = document.getElementsByTagName("body")[0];

    // create a SPAN in the document to get the width of the text we use to test
    var s = document.createElement("span");
    s.style.fontSize = testSize;
    s.innerHTML = testString;
    var defaultWidth = {};
    var defaultHeight = {};
    for (var index in baseFonts) {
        //get the default width for the three base fonts
        s.style.fontFamily = baseFonts[index];
        h.appendChild(s);
        defaultWidth[baseFonts[index]] = s.offsetWidth; //width for the default font
        defaultHeight[baseFonts[index]] = s.offsetHeight; //height for the defualt font
        h.removeChild(s);
    }

    function detect(font) {
        var detected = false;
        for (var index in baseFonts) {
            s.style.fontFamily = font + ',' + baseFonts[index]; // name of the font along with the base font for fallback.
            h.appendChild(s);
            var matched = (s.offsetWidth != defaultWidth[baseFonts[index]] || s.offsetHeight != defaultHeight[baseFonts[index]]);
            h.removeChild(s);
            detected = detected || matched;
        }
        return detected;
    }

    this.detect = detect;
};
window.addEventListener('load', function() {
  var screen_canvas = document.getElementById('tesseract');
  var renderer = new Pre3d.Renderer(screen_canvas);

  var shape = Pre3d.ShapeUtils.makeTesseract(2);

  renderer.draw_overdraw = false;
  renderer.fill_rgba = new Pre3d.RGBA(0xff/255, 0xff/255, 0xff/255, 0);
  renderer.ctx.lineWidth = 2;
  renderer.stroke_rgba = new Pre3d.RGBA(0xdd/255, 0xdd/255, 0xdd/255, 0.25);

  function setTransform(x, y) {
    var ct = renderer.camera.transform;
    ct.reset();
    ct.rotateZ(0.0);
    ct.rotateY(-2.06 * x - 0.5);
    ct.rotateX(2.2 * y + 1.5);
    ct.translate(0, 0, -12);
  }

  renderer.camera.focal_length = 6;
  setTransform(0, 0);

  function draw() {
    renderer.clearBackground();
    renderer.bufferShape(shape);
    renderer.drawBuffer();
    renderer.emptyBuffer();
  }
  
  // Listen mousemove for rotation
  
  document.addEventListener('mousemove', function(e) {
    setTransform(e.clientX / 1600, e.clientY / 1600);
    draw();
  }, false);
  
  // Set interval for rotation of a Tesseract
  
  var phase = 0;
  // the denominator determins number of moves in a period
  var deltaPhase = 2*Math.PI/1600 ; 
  intervalId = setInterval(function(){
    phase += deltaPhase;
    shape = Pre3d.ShapeUtils.rotateTesseract(shape, phase);
    draw();
  },40);
  
  draw();
}, false);