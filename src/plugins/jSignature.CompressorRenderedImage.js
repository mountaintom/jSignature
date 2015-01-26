/** @license
jSignature v2 Render JPEG and PNG Image export plugin.

Copyright (c) 2015 Tom Stall mtm{removethis}@mountaintom.com
MIT License Tom Stall

Based on code: Copyright (c) 2012 Willow Systems Corp http://willow-systems.com
MIT License <http://www.opensource.org/licenses/mit-license.php>
*/

/*
 Plugin to allow modern browsers to render vectors to an image directly, without the need to do this through backend code.
 This plugin is primarily intended for Mobile Apps and other situations where modern browsers are used.

 This plugin will render signature to an image independent of size of signature capture, without 
 the decorations. Just like the backend rendering would do.

 20150126: This is the alpha/debug version of the code. 
 Some debugging code is still in place, the plugin attaches a visible canvas to a div in the DOM, 
 and the configuration is hard coded. These things will all be fixed. 
*/


var render_size_x = 301;
var render_size_y = 201;

;(function(){
	'use strict'
		
/** @preserve
Simplify.js BSD 
(c) 2012, Vladimir Agafonkin
mourner.github.com/simplify-js

*/
	;(function(a,b){function c(a,b){var c=a.x-b.x,d=a.y-b.y;return c*c+d*d}function d(a,b,c){var d=b.x,e=b.y,f=c.x-d,g=c.y-e,h;if(f!==0||g!==0)h=((a.x-d)*f+(a.y-e)*g)/(f*f+g*g),h>1?(d=c.x,e=c.y):h>0&&(d+=f*h,e+=g*h);return f=a.x-d,g=a.y-e,f*f+g*g}function e(a,b){var d,e=a.length,f,g=a[0],h=[g];for(d=1;d<e;d++)f=a[d],c(f,g)>b&&(h.push(f),g=f);return g!==f&&h.push(f),h}function f(a,c){var e=a.length,f=typeof Uint8Array!=b+""?Uint8Array:Array,g=new f(e),h=0,i=e-1,j,k,l,m,n=[],o=[],p=[];g[h]=g[i]=1;while(i){k=0;for(j=h+1;j<i;j++)l=d(a[j],a[h],a[i]),l>k&&(m=j,k=l);k>c&&(g[m]=1,n.push(h),o.push(m),n.push(m),o.push(i)),h=n.pop(),i=o.pop()}for(j=0;j<e;j++)g[j]&&p.push(a[j]);return p}"use strict";var g=typeof exports!=b+""?exports:a;g.simplify=function(a,c,d){var g=c!==b?c*c:1;return d||(a=e(a,g)),a=f(a,g),a}})(window);


	/**
	Vector class. Allows us to simplify representation and manipulation of coordinate-pair
	representing shift against (0, 0)

	@public
	@class
	@param
	@returns {Type}
	*/
	function Vector(x,y){
		this.x = x
		this.y = y
		this.reverse = function(){
			return new this.constructor( 
				this.x * -1
				, this.y * -1
			)
		}
		this._length = null
		this.getLength = function(){
			if (!this._length){
				this._length = Math.sqrt( Math.pow(this.x, 2) + Math.pow(this.y, 2) )
			}
			return this._length
		}
		
		var polarity = function (e){
			return Math.round(e / Math.abs(e))
		}
		this.resizeTo = function(length){
			// proportionally changes x,y such that the hypotenuse (vector length) is = new length
			if (this.x === 0 && this.y === 0){
				this._length = 0
			} else if (this.x === 0){
				this._length = length
				this.y = length * polarity(this.y)
			} else if(this.y === 0){
				this._length = length
				this.x = length * polarity(this.x)
			} else {
				var proportion = Math.abs(this.y / this.x)
					, x = Math.sqrt(Math.pow(length, 2) / (1 + Math.pow(proportion, 2)))
					, y = proportion * x
				this._length = length
				this.x = x * polarity(this.x)
				this.y = y * polarity(this.y)
			}
			return this
		}
		
		/**
		 * Calculates the angle between 'this' vector and another.
		 * @public
		 * @function
		 * @returns {Number} The angle between the two vectors as measured in PI. 
		 */
		this.angleTo = function(vectorB) {
			var divisor = this.getLength() * vectorB.getLength()
			if (divisor === 0) {
				return 0
			} else {
				// JavaScript floating point math is screwed up.
				// because of it, the core of the formula can, on occasion, have values
				// over 1.0 and below -1.0.
				return Math.acos(
					Math.min( 
						Math.max( 
							( this.x * vectorB.x + this.y * vectorB.y ) / divisor
							, -1.0
						)
						, 1.0
					)
				) / Math.PI
			}
		}
	}

	function Point(x,y){
		this.x = x
		this.y = y
		
		this.getVectorToCoordinates = function (x, y) {
			return new Vector(x - this.x, y - this.y)
		}
		this.getVectorFromCoordinates = function (x, y) {
			return this.getVectorToCoordinates(x, y).reverse()
		}
		this.getVectorToPoint = function (point) {
			return new Vector(point.x - this.x, point.y - this.y)
		}
		this.getVectorFromPoint = function (point) {
			return this.getVectorToPoint(point).reverse()
		}
	}

	/**
	Allows one to round a number to arbitrary precision.
	Math.round() rounds to whole only.
	Number.toFixed(precision) returns a string.
	I need float to float, but with arbitrary precision, hence:

	@public
	@function
	@param number {Number}
	@param position {Number} number of digits right of decimal point to keep. If negative, rounding to the left of decimal.
	@returns {Type}
	*/
	function round (number, position){
		var tmp = Math.pow(10, position)
		return Math.round( number * tmp ) / tmp
	}

	function segmentToCurve(stroke, positionInStroke, lineCurveThreshold){
		'use strict'

		// long lines (ones with many pixels between them) do not look good when they are part of a large curvy stroke.
		// You know, the jaggedy crocodile spine instead of a pretty, smooth curve. Yuck!
		// We want to approximate pretty curves in-place of those ugly lines.
		// To approximate a very nice curve we need to know the direction of line before and after.
		// Hence, on long lines we actually wait for another point beyond it to come back from
		// mousemoved before we draw this curve.
		
		// So for "prior curve" to be calc'ed we need 4 points 
		// 	A, B, C, D (we are on D now, A is 3 points in the past.)
		// and 3 lines:
		//  pre-line (from points A to B), 
		//  this line (from points B to C), (we call it "this" because if it was not yet, it's the only one we can draw for sure.) 
		//  post-line (from points C to D) (even through D point is 'current' we don't know how we can draw it yet)
		//
		// Well, actually, we don't need to *know* the point A, just the vector A->B

		// Again, we can only derive curve between points positionInStroke-1 and positionInStroke
		// Thus, since we can only draw a line if we know one point ahead of it, we need to shift our focus one point ahead.
		positionInStroke += 1
		// Let's hope the code that calls us knows we do that and does not call us with positionInStroke = index of last point.
		
		var Cpoint = new Point(stroke.x[positionInStroke-1], stroke.y[positionInStroke-1])
		, Dpoint = new Point(stroke.x[positionInStroke], stroke.y[positionInStroke])
		, CDvector = Cpoint.getVectorToPoint(Dpoint)
		// Again, we have a chance here to draw only PREVIOUS line segment - BC
		
		// So, let's start with BC curve.
		// if there is only 2 points in stroke array (C, D), we don't have "history" long enough to have point B, let alone point A.
		// so positionInStroke should start with 2, ie
		// we are here when there are at least 3 points in stroke array.
		var Bpoint = new Point(stroke.x[positionInStroke-2], stroke.y[positionInStroke-2])
		, BCvector = Bpoint.getVectorToPoint(Cpoint)
		, ABvector
		
		if ( BCvector.getLength() > lineCurveThreshold ){
			// Yey! Pretty curves, here we come!
			if(positionInStroke > 2) {
				ABvector = (new Point(stroke.x[positionInStroke-3], stroke.y[positionInStroke-3])).getVectorToPoint(Bpoint)
			} else {
				ABvector = new Vector(0,0)
			}
			var minlenfraction = 0.05
			, maxlen = BCvector.getLength() * 0.35
			, ABCangle = BCvector.angleTo(ABvector.reverse())
			, BCDangle = CDvector.angleTo(BCvector.reverse())

			, BCP1vector = new Vector(ABvector.x + BCvector.x, ABvector.y + BCvector.y).resizeTo(
				Math.max(minlenfraction, ABCangle) * maxlen
				)
			, CCP2vector = (new Vector(BCvector.x + CDvector.x, BCvector.y + CDvector.y)).reverse().resizeTo(
				Math.max(minlenfraction, BCDangle) * maxlen
				)

			
			basicCurve(
				canvasContext
				, Bpoint.x
				, Bpoint.y
				, Cpoint.x
				, Cpoint.y
				, Bpoint.x + BCP1vector.x
				, Bpoint.y + BCP1vector.y
				, Cpoint.x + CCP2vector.x
				, Cpoint.y + CCP2vector.y
				);

			// returing curve for BC segment
			// all coords are vectors against Bpoint
			return []
			} else {
				basicLine(
					canvasContext
					, Bpoint.x
					, Bpoint.y
					, Cpoint.x
					, Cpoint.y
					);

				return []
			}
		}

	function lastSegmentToCurve(stroke, lineCurveThreshold){
		'use strict'
		// Here we tidy up things left unfinished
		
		// What's left unfinished there is the curve between the last points
		// in the stroke
		// We can also be called when there is only one point in the stroke (meaning, the 
		// stroke was just a dot), in which case there is nothing for us to do.

		// So for "this curve" to be calc'ed we need 3 points 
		// 	A, B, C
		// and 2 lines:
		//  pre-line (from points A to B), 
		//  this line (from points B to C) 
		// Well, actually, we don't need to *know* the point A, just the vector A->B
		// so, we really need points B, C and AB vector.
		var positionInStroke = stroke.x.length - 1
		
		// there must be at least 2 points in the stroke.for us to work. Hope calling code checks for that.
		var Cpoint = new Point(stroke.x[positionInStroke], stroke.y[positionInStroke])
		, Bpoint = new Point(stroke.x[positionInStroke-1], stroke.y[positionInStroke-1])
		, BCvector = Bpoint.getVectorToPoint(Cpoint)
		
		if (positionInStroke > 1 && BCvector.getLength() > lineCurveThreshold){
			// we have at least 3 elems in stroke
			var ABvector = (new Point(stroke.x[positionInStroke-2], stroke.y[positionInStroke-2])).getVectorToPoint(Bpoint)
			, ABCangle = BCvector.angleTo(ABvector.reverse())
			, minlenfraction = 0.05
			, maxlen = BCvector.getLength() * 0.35

			var BCP1vector = new Vector(ABvector.x + BCvector.x, ABvector.y + BCvector.y).resizeTo(
				Math.max(minlenfraction, ABCangle) * maxlen )


			basicCurve(
				canvasContext
				, Bpoint.x
				, Bpoint.y
				, Cpoint.x
				, Cpoint.y
				, Bpoint.x + BCP1vector.x
				, Bpoint.y + BCP1vector.y
				, Cpoint.x // CP2 is same as Cpoint
				, Cpoint.y // CP2 is same as Cpoint
				);

			
			return []
		} else {
			// Since there is no AB leg, there is no curve to draw. This is just line

				basicLine(
					canvasContext
					, Bpoint.x
					, Bpoint.y
					, Cpoint.x
					, Cpoint.y
					);

			return []
		}
	}

	function drawstroke(stroke){
		'use strict'

				// processing all points but first and last. 
		var i = 1 // index zero item in there is STARTING point. we already extracted it.
		, l = stroke.x.length - 1 // this is a trick. We are leaving last point coordinates for separate processing.
		, lineCurveThreshold = 1
		
		for(; i < l; i++){
			segmentToCurve(stroke, i, lineCurveThreshold)
		}
		if (l > 0 /* effectively more than 1, since we "-1" above */){
			lastSegmentToCurve(stroke, i, lineCurveThreshold)
		} else if (l === 0){
			// meaning we only have ONE point in the stroke (and otherwise refer to the stroke as "dot")

		basicDot(
		canvasContext
			, stroke.x[0]
			, stroke.y[0]
			, 2
		);

					//alert('dot spot');

		}
		return ('Hello World')
	}

	function simplifystroke(stroke){
		var d = []
		, newstroke = {'x':[], 'y':[]}
		, i, l
		
		for (i = 0, l = stroke.x.length; i < l; i++){
			d.push({'x':stroke.x[i], 'y':stroke.y[i]})
		}
		d = simplify(d, 0.7, true)
		for (i = 0, l = d.length; i < l; i++){
			newstroke.x.push(d[i].x)
			newstroke.y.push(d[i].y)
		}		
		return newstroke
	}

	function drawImageOnCanvas(data, settings){
		'use strict'
		var i , l = data.length
		, stroke
		, xlimits = []
		, ylimits = []
		, sizex = 0
		, sizey = 0
		, shiftx = 0
		, shifty = 0
		, minx, maxx, miny, maxy, padding = 1
		, simplifieddata = []

		canvasx.width = render_size_x;
		canvasx.height = render_size_y;
		canvasx.style.width = render_size_x;
		canvasx.style.height = render_size_y;

		canvasContext.lineWidth = 2;
	    canvasContext.lineCap = canvasContext.lineJoin = "round";

		canvasContext.fillStyle = 'white';
		canvasContext.fillRect(0, 0, canvasx.width, canvasx.height);

		
		if(l !== 0){
			for(i = 0; i < l; i++){
				stroke = simplifystroke( data[i] )
				simplifieddata.push(stroke)
				xlimits = xlimits.concat(stroke.x)
				ylimits = ylimits.concat(stroke.y)
			}
			 
			minx = Math.min.apply(null, xlimits) - padding
			maxx = Math.max.apply(null, xlimits) + padding
			miny = Math.min.apply(null, ylimits) - padding
			maxy = Math.max.apply(null, ylimits) + padding
			shiftx = minx < 0? 0 : minx
			shifty = miny < 0? 0 : miny
			sizex = maxx - minx
			sizey = maxy - miny
		}

		
		// Normalize and scale stroke data
		if(sizex > 0 && sizey > 0){
			var scaleFactor = Math.min(render_size_x / sizex, render_size_y / sizey);

			for(i = 0, l = simplifieddata.length; i < l; i++){
				stroke = simplifieddata[i]

				for(var ii = 0, ll = stroke.x.length; ii < ll; ii++){
					stroke.x[ii] = (stroke.x[ii] - shiftx) * scaleFactor;
					stroke.y[ii] = (stroke.y[ii] - shifty) * scaleFactor;
				}
			}
		}
		
		for(i = 0, l = simplifieddata.length; i < l; i++){
			stroke = simplifieddata[i]
			drawstroke(stroke);
		}
		return('This could be data')
	}

	if (typeof btoa !== 'function')
	{
		var btoa = function(data) {
/** @preserve
base64 encoder
MIT, GPL
http://phpjs.org/functions/base64_encode
+   original by: Tyler Akins (http://rumkin.com)
+   improved by: Bayron Guevara
+   improved by: Thunder.m
+   improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
+   bugfixed by: Pellentesque Malesuada
+   improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
+   improved by: Rafal Kukawski (http://kukawski.pl)

*/
		    var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
		    , b64a = b64.split('')
		    , o1, o2, o3, h1, h2, h3, h4, bits, i = 0,
	        ac = 0,
	        enc = "",
	        tmp_arr = [];
		 
		    do { // pack three octets into four hexets
		        o1 = data.charCodeAt(i++);
		        o2 = data.charCodeAt(i++);
		        o3 = data.charCodeAt(i++);
		 
		        bits = o1 << 16 | o2 << 8 | o3;
		 
		        h1 = bits >> 18 & 0x3f;
		        h2 = bits >> 12 & 0x3f;
		        h3 = bits >> 6 & 0x3f;
		        h4 = bits & 0x3f;
		 
		        // use hexets to index into b64, and append result to encoded string
		        tmp_arr[ac++] = b64a[h1] + b64a[h2] + b64a[h3] + b64a[h4];
		    } while (i < data.length);

		    enc = tmp_arr.join('');
		    var r = data.length % 3;
		    return (r ? enc.slice(0, r - 3) : enc) + '==='.slice(r || 3);

		    // end of base64 encoder MIT, GPL
		}
	}

	function renderBase64JPEG(data, settings){
		drawImageOnCanvas(data, settings);
		var splitData = canvasx.toDataURL('image/jpeg').split(',');
		return(splitData);
	}

	function renderBase64PNG(data, settings){
		drawImageOnCanvas(data, settings);
		var splitData = canvasx.toDataURL('image/png').split(',');
		return(splitData);
	}

	var base64encodedJPEGmime = 'image/jpeg;base64'
	function getBase64encodedJPEG(data, settings){

		var splitData = renderBase64JPEG(data, settings);

		return ([base64encodedJPEGmime , splitData[1]]);

	} 

	var base64encodedPNGmime = 'image/png;base64'
	function getBase64encodedPNG(data, settings){

		var splitData = renderBase64PNG(data, settings);

		return ([base64encodedPNGmime , splitData[1]]);
	} 



	var canvasContext;
	var canvasx;

	function Initializer($){
		var mothership = $.fn['jSignature']
		mothership(
			'addPlugin'
			,'export'
			,'renderedjpegbase64'
			,getBase64encodedJPEG
		)
		mothership(
			'addPlugin'
			,'export'
			,'renderedpngbase64'
			,getBase64encodedPNG
		)

		//alert ('Hello World');
		//$("#RITest").append("<p>zzzTest01</p>");
		//$("<p>zzzTest02</p>").appendTo("#RITest");

			canvasx = document.createElement('canvas')
			var $canvas = $(canvasx);
			$canvas.appendTo('#RITest');
			$canvas.attr('id', 'CompressorRenderImageID')
			$canvas.addClass('CompressorRenderImageClass');
			canvasContext = canvasx.getContext("2d");

	}

	var basicDot = function(ctx, x, y, size){
		var fillStyle = ctx.fillStyle;
		ctx.fillStyle = ctx.strokeStyle;
		ctx.fillRect(x + size / -2 , y + size / -2, size, size);
		ctx.fillStyle = fillStyle;
	}
	, basicLine = function(ctx, startx, starty, endx, endy){
		ctx.beginPath();
		ctx.moveTo(startx, starty);
		ctx.lineTo(endx, endy);
		ctx.closePath();
		ctx.stroke();
	}
	, basicCurve = function(ctx, startx, starty, endx, endy, cp1x, cp1y, cp2x, cp2y){
		ctx.beginPath();
		ctx.moveTo(startx, starty);
		ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endx, endy);
		ctx.closePath();
		ctx.stroke();
	}

	//  //Because plugins are minified together with jSignature, multiple defines per (minified) file blow up and dont make sense
	//	//Need to revisit this later.
		
	if(typeof $ === 'undefined') {throw new Error("We need jQuery for some of the functionality. jQuery is not detected. Failing to initialize...")}
	Initializer($)

})();
