/* TextareaDecorator.js
 * written by Colin Kuebler 2012
 * Part of LDT, dual licensed under GPLv3 and MIT
 * Builds and maintains a styled output layer under a textarea input layer
 */
function TextareaDecorator(textarea, parser) {
	/* INIT */
	var api = this;
	this.parser = parser;
	this.errorMap = {};

	// construct editor DOM
	var parent = document.createElement("div");
	var output = document.createElement("pre");
	parent.appendChild(output);
	var label = document.createElement("label");
	parent.appendChild(label);
	// replace the textarea with RTA DOM and reattach on label
	textarea.parentNode.replaceChild(parent, textarea);
	label.appendChild(textarea);
	// transfer the CSS styles to our editor
	parent.className = 'ldt ' + textarea.className;
	textarea.className = '';
	// turn off built-in spellchecking in firefox
	textarea.spellcheck = false;
	// turn off word wrap
	textarea.wrap = "off";

	var getParser = () => {
		return this.parser;
	}

	var getErrorMap = () => {
		return this.errorMap;
	}

	// coloring algorithm
	var color = function (input, output, parser) {
		var oldTokens = output.childNodes;
		var newTokens = parser.tokenize(input);
		var firstDiff, lastDiffNew, lastDiffOld;
		output.innerHTML = '';

		// add in modified spans
		for (const token of newTokens) {
			var span = document.createElement("span");
			span.className = token.tag;
			if (getErrorMap()[token.lineNumber]) {
				span.classList.add('error');
			}
			span.textContent = span.innerText = token.text;
			output.appendChild(span);
		}
	};

	api.input = textarea;
	api.output = output;
	api.update = function () {
		var input = textarea.value;
		if (input) {
			color(input, output, getParser());
			// determine the best size for the textarea
			var lines = input.split('\n');
			// find the number of columns
			var maxlen = 0, curlen;
			for (var i = 0; i < lines.length; i++) {
				// calculate the width of each tab
				var tabLength = 0, offset = -1;
				while ((offset = lines[i].indexOf('\t', offset + 1)) > -1) {
					tabLength += 7 - (tabLength + offset) % 8;
				}
				var curlen = lines[i].length + tabLength;
				// store the greatest line length thus far
				maxlen = maxlen > curlen ? maxlen : curlen;
			}
			textarea.cols = maxlen + 1;
			textarea.rows = lines.length + 2;
		} else {
			// clear the display
			output.innerHTML = '';
			// reset textarea rows/cols
			textarea.cols = textarea.rows = 1;
		}
	};

	// detect all changes to the textarea,
	// including keyboard input, cut/copy/paste, drag & drop, etc
	if (textarea.addEventListener) {
		// standards browsers: oninput event
		textarea.addEventListener("input", api.update, false);
	} else {
		// MSIE: detect changes to the 'value' property
		textarea.attachEvent("onpropertychange",
			function (e) {
				if (e.propertyName.toLowerCase() === 'value') {
					api.update();
				}
			}
		);
	}
	// initial highlighting
	api.update();

	api.setErrorMap = (errors) => {
		this.errorMap = errors;
		api.update();
	}

	return api;
};

