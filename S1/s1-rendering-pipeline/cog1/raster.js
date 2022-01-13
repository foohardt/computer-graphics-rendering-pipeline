define(["exports", "shader", "framebuffer", "data", "glMatrix"], //
	function (exports, shader, framebuffer, data) {
		"use strict";

		// Drawing context for canvas.
		// Passed to initialize framebuffer.
		// As raster uses the framebuffer to access the canvas ctx is for debug.
		var ctx;
		// Width and height of the ctx are used for clipping.
		var width;
		var height;

		// Plane equation of polygon.
		var A = 1;
		var B = 1;
		var C = 1;
		var D = 1;
		// Pre-calculate for speed-up.
		// 1 / C.
		var inverseC;
		// A / C.
		var AdivC;

		// For each polygon we store all points from all edges
		// generated by the Bresenham algorithm.
		// They are use for the scanline fill algorithm.
		// After processing a polygon the data structures are reset.
		// The Structure is 2D: one array for every scanline.
		// Thus the array index is the y value.
		// An array-entry is again an object containing the x,z values
		// and for indices and weights for interpolation.
		// See addIntersection().
		var scanlineIntersection = [];

		// Data for bi-linear interpolation. Uses for exchange.
		// Filled on demand from the interpolation functions.
		var interpolationData = {};

		function init(_ctx, _bgColor) {
			ctx = _ctx;
			width = ctx.width;
			height = ctx.height;
			framebuffer.init(ctx, _bgColor);
		}

		/**
		 * Convenience function when start and end points are given as 3D-vectors
		 * and only lines (no filled polygons) are to be drawn.
		 * This is used to, e.g., draw normals, or a grid.
		 *
		 * @parameter st, end: start and end point of line segment.
		 */
		function drawLineBresenhamGivenStartEndPoint(st, end, color) {

			// Convert parameters to integer values.
			// Use (not not ~~) instead of Math.floor() for integer cast and rounding of X-Y values.
			// Leave Z as floating point for comparisons in z-buffer.
			drawLineBresenham(~~st[0], ~~st[1], st[2], ~~end[0], ~~end[1], end[2], color, true);
		}

		/**
		 * Calculate lines with Bresenham algorithm.
		 * Draw points or store intersections of the current edge for scanline,
		 * depending on the fill.
		 *
		 * On a step register only the left most point as an intersection.
		 *
		 * @parameter x,y,z: X-Y Start and end points should be integer values, Z should be floating point for Z-Buffer.
		 * @parameter storeIntersectionForScanlineFill: if false edges are only calculated to be filled with scanline but not drawn.
		 * @parameter [only for fill] edgeStartVertexIndex, edgeEndVertexIndex : Start and end of line segment stored in intersection for interpolation.
		 * @parameter [only for textureing] edgeStartTextureCoord, edgeEndTextureCoord : Texture uv-vectors (not the indices) for edge currently processed.
		 */
		function drawLineBresenham(startX, startY, startZ, endX, endY, endZ, color, storeIntersectionForScanlineFill, edgeStartVertexIndex, edgeEndVertexIndex, edgeStartTextureCoord, edgeEndTextureCoord) {
			// Let endX be larger than startX.
			// In this way on a shared edge between polygons the same left most fragment
			// is stored as intersection and the will never be a gap on a step of the edge.
			if (endX < startX) {
				return drawLineBresenham(endX, endY, endZ, startX, startY, startZ, color, storeIntersectionForScanlineFill, edgeEndVertexIndex, edgeStartVertexIndex, edgeEndTextureCoord, edgeStartTextureCoord);
			}

			if (!storeIntersectionForScanlineFill) {
				// Set rgbaShaded to rgba in case we do not apply shading.
				vec3.set(color.rgba, color.rgbaShaded);
				// set Alpha.
				color.rgbaShaded[3] = color.rgba[3];
			}

			var dX = endX - startX;
			var dY = endY - startY;
			var dXAbs = Math.abs(dX);
			var dYAbs = Math.abs(dY);

			// Determine the direction to step.
			var dXSign = dX >= 0 ? 1 : -1;
			var dYSign = dY >= 0 ? 1 : -1;

			// shorthands for speedup.
			var dXAbs2 = 2 * dXAbs;
			var dYAbs2 = 2 * dYAbs;
			var dXdYdiff2 = 2 * (dXAbs - dYAbs);
			var dYdXdiff2 = 2 * (dYAbs - dXAbs);

			// Decision variable.
			var e;
			// Loop variables.
			var x = startX;
			var y = startY;
			var z = startZ;

			// z is linearly interpolated with delta dz in each step of the driving variable.
			var dz;

			// Prepare bi-linear interpolation for shading and textureing.
			// Interpolated weight in interval [0,1] of the starting- and end-point of the current edge.
			// The weight is the relative distance form the starting point.
			// It is stored with an intersection for interpolation used for shading and textureing.
			// The interpolation step is done in synchronous to the driving variable.
			var interpolationWeight = 0;
			var deltaInterpolationWeight;

			// BEGIN exercise Bresenham
			// Comment out the next two lines.
			// drawLine(startX, startY, endX, endY, color);
			// return;

			// Skip it, if the line is just a point.
			if ((dXAbs == 0) && (dYAbs == 0)) {
				return;
			}
			// Distinction of cases for driving variable.
			if (dXAbs >= dYAbs) {
				// x is driving variable.
				e = dXAbs - dYAbs2;
				deltaInterpolationWeight = 1 / dXAbs;
				while (x != endX) {
					x = x + dXSign;
					if (e > 0) {
						e = e - dYAbs2;
					} else {	// y-value changes
						y = y + dYSign;
						e = e + dXdYdiff2;
						// Check storeIntersectionForScanLineFill
						// ignore first and last row
						if ((y != startY) && (y != endY)) {
							addIntersection(x, y, z, interpolationWeight, edgeStartVertexIndex, edgeEndVertexIndex);
						}
					}
					// draw pixel with current x and y values
					framebuffer.set(x, y, z, color);
				}
			} else {
				// y is driving variable.
				e = dYAbs - dXAbs2;
				// loop until endX is reached
				deltaInterpolationWeight = 1 / dYAbs;
				while (y != endY) {
					y = y + dYSign;
					if (e > 0) {
						e = e - dXAbs2;
					} else {
						x = x + dXSign;
						e = e + dYdXdiff2;
					}
					// draw pixel with current x and y values
					// Check storeIntersectionForScanLineFill
					if ((y != startY) && (y != endY)) {
						addIntersection(x, y, z, interpolationWeight, edgeStartVertexIndex, edgeEndVertexIndex);
					}
					framebuffer.set(x, y, z, color);

				}
			}


			// END exercise Bresenham		
		};

		/**
		 * Draw edges of given polygon. See also scanlineFillPolygon().
		 *
		 * @parameter vertices as array from data
		 * @parameter one polygon as 1D-array (one element from polygonVertices, thus one polygon) from data.
		 * @parameter color as defined in data
		 *
		 */
		function scanlineStrokePolygon(vertices, polygon, color) {

			// Loop over vertices/edges in polygon.
			for (var v = 0; v < polygon.length; v++) {

				// Determine start st and end point end of edge.
				var start = vertices[polygon[v]];
				// Connect edge to next or to first vertex to close the polygon.
				var nextVertexIndex = (v < polygon.length - 1) ? v + 1 : 0;
				var end = vertices[polygon[nextVertexIndex]];

				// Draw current vertex
				drawLineBresenhamGivenStartEndPoint(start, end, color);
			}
		}

		/**
		 * Called from scanline as preparation.
		 * Call Bresenham on all edges to fill scanlineIntersection data structure.
		 */
		function assembleIntersectionForScanline(vertices, polygon, color, textureCoord, polygonTextureCoord, texture) {
			// Use Math.floor() for integer cast and rounding of X-Y values.
			// Leave Z as floating point for comparisons in z-buffer.
			var currX, currY, currZ, nextX, nextY, nextZ;
			var startPoint, endPoint, lastIndex = 0;

			// Clear data-structure for scanline segments.
			clearIntersections();

			// Calculate the plane in which the polygon lies
			// to determine z-values of intermediate points.
			// Maybe skip polygons that are perpendicular to the screen / xy-plane.
			// The plane calculation can be commented out if bi-linear interpolation is applied.
			if (!calcPlaneEquation(vertices, polygon)) {
				//console.log("Skip plane(polygon) is perpendicular to the screen / xy-plane, color: " + color.name);
				return;
			}

			// Sign ()+-1) of derivative of edge.
			var derivative = undefined;
			var lastDerivative = undefined;

			// BEGIN exercise Texture
			// BEGIN exercise Scanline

			// compute "last derivative" for the first edge
			for (var i = polygon.length - 1; i > 0; i--) {
				// Read x,y,z values from vertices into 2D array
				var vert = vertices[polygon[i]]
				if (i == polygon.length - 1) {
					lastDerivative = getDerivativeSign(vert[1], vertices[polygon[0]][1])
				} else {
					lastDerivative = getDerivativeSign(vert[1], vertices[polygon[i + 1]][1])

				}
				if (lastDerivative != 0) { break; }

			}

			if (!lastDerivative) {
				// console.log("Skip polygon, it has no extension in xy-plane: " + polygon);
				return;
			}

			// First raster only the edges and, if requested, store intersections for filling.

			// Loop over vertices/edges in polygon.
			var edgeStartVertexIndex;
			var edgeEndVertexIndex;

			var edgeStartTextureCoord = 0;
			var edgeEndTextureCoord = 0;
			for (var i = 0; i < polygon.length; i++) {

				// Determine start and end point of edge.
				currX = Math.floor(vertices[polygon[i]][0]);
				currY = Math.floor(vertices[polygon[i]][1]);
				currZ = 0.0;
				nextZ = 0.0;

				edgeStartVertexIndex = polygon[i];
				if (i == polygon.length - 1) {
					nextX = Math.floor(vertices[polygon[0]][0]);
					nextY = Math.floor(vertices[polygon[0]][1]);
					edgeEndVertexIndex = polygon[0];
				} else {
					nextX = Math.floor(vertices[polygon[i + 1]][0]);
					nextY = Math.floor(vertices[polygon[i + 1]][1]);
					edgeEndVertexIndex = polygon[i + 1];
				}



				derivative = getDerivativeSign(currY, nextY);

				if (derivative == 0) { continue; }
				drawLineBresenham(currX, currY, currZ, nextX, nextY, nextZ, color, false, edgeStartVertexIndex, edgeEndVertexIndex, edgeStartTextureCoord, edgeEndTextureCoord)
				addIntersection(nextX, nextY, nextZ, 0, edgeStartVertexIndex, edgeEndVertexIndex, edgeStartTextureCoord, edgeEndTextureCoord);
				if ((lastDerivative + derivative == 0) && (derivative != 0)) {
					addIntersection(currX, currY, currZ, 0, edgeStartVertexIndex, edgeEndVertexIndex, edgeStartTextureCoord, edgeEndTextureCoord);
				}       // Convert parameters to integer values.
				// Use Math.floor() for integer cast and rounding of X-Y values.

				if (derivative != 0) { lastDerivative = derivative; }
				// Calculate current derivative.
				//console.log("derivative:" + derivative + " lastDerivative " + lastDerivative);

			}
		}


		/**
		 * Called once for each scanline before it is processed.
		 * Interpolate: z, weights of corners, texture coordinates.
		 *
		 * @parameter texture: if not null do interpolate UV.
		 */
		function interpolationPrepareScanline(startIntersection, endIntersection, texture) {

			// Start-point for filling on scanline.
			var xStartFill = startIntersection.x;
			// End-point for filling on scanline.
			var xEndFill = endIntersection.x;
			// Start and end for z-interpolated.
			var zStartFill = startIntersection.z;
			var zEndFill = endIntersection.z;

			interpolationData.z = zStartFill;

			// To calculate dz.
			var deltaX = xEndFill - xStartFill;

			// BEGIN exercise Z-Buffer

			// Calculate dz for linear interpolation along a scanline.

			// END exercise Z-Buffer

			// BEGIN exercise Shading

			// Interpolation for shader.
			// Bi-linear interpolation. Alternatively use barycentric coordinates.
			// Interpolation weight from one intersection to the next.
			// One weight for each of the four(three) corners/vertices (one corner appears two times) of the polygon,
			// which are involved in a scanline segment, interpolationVertices.
			interpolationData.vertexIndices = [startIntersection.edgeStartVertexIndex, startIntersection.edgeEndVertexIndex, endIntersection.edgeStartVertexIndex, endIntersection.edgeEndVertexIndex];
			// Initial weight for the starting points on a scanline segment.
			var interpolationWeightStart = startIntersection.interpolationWeight;
			var interpolationWeightEnd = endIntersection.interpolationWeight;
			interpolationData.weights = [1 - interpolationWeightStart, interpolationWeightStart, 1 - interpolationWeightEnd, interpolationWeightEnd];

			// The interpolation work on the scanline is done in the shader,
			// as only the specific shader knows what to interpolate.
			interpolationData.shaderPrepareScanline(interpolationData.vertexIndices, interpolationData.weights, deltaX);

			// Variables for interpolation step on scanline.
			interpolationData.weightOnScanline = 0.0;
			interpolationData.deltaWeightOnScanline = 1.0 / (deltaX == 0 ? 1 : deltaX);

			// END exercise Shading

			// BEGIN exercise Texture

			// Reuse the weights calculated for shading.

			// Interpolation of coordinates for texture sampler.
			// Bi-linear interpolation. Alternatively use barycentric coordinates.
			if (texture != null) {
				// Texture coordinates vector: u,v (x,y with origin top left).
				if (!interpolationData.uvVec) {
					interpolationData.uvVec = [];
				}
				if (!interpolationData.uvVecDelta) {
					interpolationData.uvVecDelta = [];
				}
				// Loop u,v texture coordinates vector.

				// Interpolate on first edge.

				// Interpolate on second edge.

				// Delta on scanline.

				// Starting value on scanline.
			}

			// END exercise Texture
		}

		/**
		 * Called for each fragment on scanline, thus inside x-loop.
		 * Interpolate: z, weights of corners, texture coordinates.
		 *
		 * @parameter texture: if not null do interpolate UV.
		 */
		function interpolationStepOnScanline(texture) {

			// BEGIN exercise Z-Buffer

			// Calculate z for next pixel, i.e. apply dz step.

			// END exercise Z-Buffer


			// BEGIN exercise Shading

			// Step interpolation in shader.
			interpolationData.shaderStepOnScanline();

			// Calculate an interpolation weight from 0 to 1 on each scanline segment.
			// interpolationData.weights.forEach(function(scope, index, array) {
			// array[index] += deltaInterpolationWeight[index];
			// });
			interpolationData.weightOnScanline += interpolationData.deltaWeightOnScanline;

			// END exercise Shading

			// BEGIN exercise Texture

			// Stepping interpolation of texture coordinates.
			if (texture != null) {
				// interpolationData.uvVec[0] += interpolationData.uvVecDelta[0];
				// interpolationData.uvVec[1] += interpolationData.uvVecDelta[1];
			}

			// END exercise Texture
		}

		/**
		 * Fill a polygon into the framebuffer.
		 *
		 * Use bi-linear interpolation or plane-equation to determine the z-values.
		 * Use bi-linear interpolation or barycentric coordinates for texture and shading interpolation.
		 * Be aware of rasterization errors (floor) when calculating derivatives and dz.
		 *
		 * @parameter vertices as array from data
		 * @parameter one polygon as 1D-array (one element from polygonVertices, thus one polygon) from data.
		 * @parameter color as defined in data
		 * @parameter fill or stroke outline
		 * @parameter textureCoord only useful when texturing is implemented an applied.
		 * @parameter polygonTextureCoord for current polygon as 1D-array (one element from polygonTextureCoord) from data.
		 * @parameter texture object for sampling, set to null to skip texturing.
		 */

		function scanlineFillPolygon(vertices, polygon, color, textureCoord, polygonTextureCoord, texture) {
			var horizontalClippingTest;
			var zTest;

			// Raster the edges.
			assembleIntersectionForScanline(vertices, polygon, color, textureCoord, polygonTextureCoord, texture);
			// console.log("scanlength" + scanlineIntersection.length);
			// Use the shader/shading-function that is set for this polygon.
			// Store function reference outside the loops for speed.
			// Only useful if light an shading is applied.
			var shadingFunction = shader.getShadingFunction();

			// Store shader function pointer for interpolation shorthands.
			interpolationData.shaderPrepareScanline = shader.getInterpolationPrepareScanlineFunction();
			interpolationData.shaderStepOnScanline = shader.getInterpolationStepOnScanlineFunction();

			// BEGIN exercise Scanline
			// BEGIN exercise Scanline

			// Fill polygon line by line using the scanline algorithm.
			// Loop over non empty scan lines.
			for (var y = 0; y < scanlineIntersection.length; y++) {
				var line = scanlineIntersection[y];
				if (!line) { continue; }

				// Do (or skip) some safety check.
				if ((line.length < 2) || (line.length % 2)) {
					// console.log("scanline intersction count is wrong y: " + y);
					// console.log(line);
					continue;
				}

				// Sort current scanline
				line.sort((a, b) => (a.x > b.x) ? 1 : -1);

				// Order intersection in scanline.
				// Loop over intersections in pairs of two.
				var z;
				for (var i = 0; i < line.length - 1; i = i + 2) {

					for (var x = line[i].x; x < line[i + 1].x; x++) {
						z = getZ(x, y);
						horizontalClippingTest = (x >= 0) && (x < width);
						framebuffer.set(x, y, z, color, true);
					}
				}
			}
		}


		// Fill line section inside polygon, loop x.
		// for (let x = firstX; x <= secondX; x++) {

		// 	// Do horizontal clipping test (true if passed).
		// 	horizontalClippingTest = (x >= 0) && (x < width);

		// 	if (horizontalClippingTest) {
		// 		zTest = framebuffer.zBufferTest(x, y, z, color);
		// 	}
		// 	// // // Fill (and shade) fragment it passed all tests.
		// 	if (zTest && horizontalClippingTest) {
		// 		//  // Get color from texture
		// 		if (texture != null) {
		// 			texture.sample(interpolationData.uvVec, color);
		// 		}
		// 		shadingFunction(color, interpolationData.weightOnScanline);
		// 		framebuffer.set(x, y, interpolationData.z, color)
		// 		// framebuffer.set without z-Test and dirty rectangle adjust.


		// }
		// interpolationStepOnScanline(texture);

		// Calculate interpolation variables for current scanline.
		// Necessary for z-buffer, shading and texturing.

		// Fill line section inside polygon, loop x.

		// Set z shorthand.

		// Do horizontal clipping test (true if passed).
		//horizontalClippingTest = (x >= 0) && (x < width);

		// Do a z-buffer test.
		// to skip the shaderFunction if it is not needed.
		// This is not perfect as we still shade fragments
		// that will not survive the frame, because
		// the z-buffer is not fully build up.
		// The Solution would be to use deferred-rendering.
		// The z-Buffer Test could also be skipped, if
		// there is only one convex model and we already do back-face culling.
		// if(horizontalClippingTest) {
		// zTest = framebuffer.zBufferTest(x, y, z, color);
		// }
		// // Fill (and shade) fragment it passed all tests.
		// if(zTest && horizontalClippingTest) {
		// // Get color from texture.
		// if(texture != null) {
		// texture.sample(interpolationData.uvVec, color);
		// }
		// shadingFunction(color, interpolationData.weightOnScanline);

		// // framebuffer.set without z-Test and dirty rectangle adjust.

		// }

		// Step interpolation variables on current scanline.
		// Even failing the z-buffer test we have to perform the interpolation step.
		// Necessary for z-buffer, shading and texturing.

		// End of loop over x for one scanline segment between two intersections.
		// End of loop over intersections on one scanline.
		// End of loop over all scanlines.
		// END exercise Scanline
		// }

		/**
		 * Calculate the derivative (only the sign) of a polygon edge.
		 * @ return +-1 or 0.
		 */
		function getDerivativeSign(currY, nextY) {
			// y axis from top to bottom.
			if (currY < nextY) {
				return -1;
			} else if (currY > nextY) {
				return +1;
			} else {
				return 0;
			}
		}

		/**
		 * Calculate and set the module variables, A,B,C,D and AdivC.
		 *
		 * @parameter vertices as array from data
		 * @parameter polygon as array (1D=one polygon) of from data.
		 * @parameter normal:
		 * the transformed normal may not fit to transformed vertices,
		 * because the normal does not undergo perspective transformation.
		 * Thus it has to be re-calculated.
		 * In this case pass null or nothing as normal parameter.
		 *
		 * @ return true if plane is in not perpendicular to xy-plane.
		 */
		function calcPlaneEquation(vertices, polygon, normal) {
			// Epsilon to check C against zero.
			var epsilon = 0.001;

			if (!normal) {
				normal = [];
				data.calculateNormalForPolygon(vertices, polygon, normal);
			}

			A = normal[0];
			B = normal[1];
			C = normal[2];

			// check C against zero.
			if (Math.abs(C) < epsilon) {
				return false;
			}

			// START exercise Z-Buffer

			inverseC = 1.0 / C;
			AdivC = A / C;

			// Project first vertex (could be any) on normal.
			// The result is the distance D of polygon plane to origin.
			var p = polygon[0];
			var x = vertices[p][0];
			var y = vertices[p][1];
			var z = vertices[p][2];
			D = -(A * x + B * y + C * z);
			// // Check result, applying the plane equation to the original polygon vertices.
			// for (var i = 0; i < polygon.length; i++) {
			// 	var p = polygon[i];
			// 	var x = vertices[p][0];
			// 	var y = vertices[p][1];
			// 	var z = vertices[p][2];
			// 	var zCalc = getZ(x, y);
			// 	if (Math.abs(z - zCalc) > 0.001) {
			// 		console.log("Check failed  z " + z + " = " + zCalc);
			// 		console.log("Plane: A=" + A + " B=" + B + " C=" + C + " D=" + D);
			// 	}
			// };

			// END exercise Z-Buffer

			return true;
		}

		/**
		 * Call for new frame.
		 */
		function clearIntersections() {
			scanlineIntersection = [];
		}

		/**
		 * Add (edge-)points from bresenham to scanlines.
		 * @parameter interpolationWeight runs from 0 to 1 from start to end Vertex.
		 * @parameter edgeStartVertexIndex, edgeEndVertexIndex :
		 *  Start and end of line segment stored in intersection for interpolation.
		 * @parameter [only for textureing] edgeStartTextureCoord,
		 *  edgeEndTextureCoord : Texture uv-vectors (not the indices) for edge currently processed.
		 */
		function addIntersection(x, y, z, interpolationWeight, edgeStartVertexIndex, edgeEndVertexIndex, edgeStartTextureCoord, edgeEndTextureCoord) {
			// Do some hacked  (vertical) clipping.
			// Points out of y-range are on no scanline and can be ignored.
			// Horizontal clipping is done in scanline to ensure correct interpolation.
			if (y < 0 || y >= height) {
				// console.log("refused:" + "x" + "y");
				return;
			}

			// Check if this is the first point on scanline to initialize array.
			if (scanlineIntersection[y] == undefined) {
				scanlineIntersection[y] = [];
			}

			// Each intersection is an object, an array is not significantly faster.
			scanlineIntersection[y].push({
				x: x,
				z: z,
				edgeStartVertexIndex: edgeStartVertexIndex,
				edgeEndVertexIndex: edgeEndVertexIndex,
				edgeStartTextureCoord: edgeStartTextureCoord,
				edgeEndTextureCoord: edgeEndTextureCoord,
				interpolationWeight: interpolationWeight
			});
			// console.log("add Intersection " + " x:" + x + " y:" + y);
			// Dirty rect has to be adjusted here, as no points are set
			// in framebuffer when edges are drawn (bresenham) and also not during scanline.
			// We have to take care the x is not out of range.
			if (x < 0) {
				x = 0;
			}
			if (x >= width) {
				x = width - 1;
			}
			framebuffer.adjustDirtyRectangle(x, y);
		}

		/**
		 * Calculate the z-value for any point on
		 * the polygon currently processed.
		 */
		function getZ(x, y) {
			// We assume that the plane equation is up-to-date
			// with the current polygon.
			var z = -(A * x + B * y + D) * inverseC;

			// Take this check out for speed.
			// if(!isFinite(z)) {
			// 	console.log("z isNaN or not isFinite for (x,y): " + x + " , " + y);
			// }

			return z;
		}

		/**
		 * For Debug
		 */
		function drawLine(startX, startY, endX, endY, color) {
			var colorname = Object.keys(color)[0];
			ctx.fillStyle = colorname;
			ctx.strokeStyle = colorname;
			ctx.beginPath();
			ctx.moveTo(startX, startY);
			ctx.lineTo(endX, endY);
			//ctx.closePath();
			ctx.stroke();
		}

		// Public API.
		exports.init = init;
		exports.drawLineBresenhamGivenStartEndPoint = drawLineBresenhamGivenStartEndPoint;
		exports.scanlineStrokePolygon = scanlineStrokePolygon;
		exports.scanlineFillPolygon = scanlineFillPolygon;
	});