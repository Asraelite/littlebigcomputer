/* Parser.js
 * written by Colin Kuebler 2012
 * Part of LDT, dual licensed under GPLv3 and MIT
 * Generates a tokenizer from regular expressions for TextareaDecorator
 */

function Parser(rules, useI) {
	/* INIT */
	const api = this;

	// variables used internally
	const i = useI ? 'i' : '';
	let parseRegex = null;
	let ruleSrc = [];
	let ruleNames = [];
	let ruleMap = {};

	api.add = function (rules) {
		for (const [name, rule] of Object.entries(rules)) {
			let s = rule.source;
			s = '(?<' + name + '>' + s + ')';
			ruleSrc.push(s);
			// ruleMap[rule] = new RegExp('^(' + s + ')$', i);
			ruleNames.push(name);
		}
		parseRegex = new RegExp(ruleSrc.join('|'), 'gm' + i);
	};
	api.tokenize = function (input) {
		const tokens = [];
		const lines = input.match(/.*\n?/gm);
		for (const [lineNumber, line] of lines.entries()) {
			for (const match of line.matchAll(parseRegex)) {
				for (const ruleName of ruleNames) {
					if (match.groups[ruleName] !== undefined) {
						tokens.push({
							tag: ruleName,
							text: match[0],
							lineNumber,
						});
						break;
					}
				}
			}
		}
		return tokens;
	};
	api.identify = function (token) {
		return token.tag;
	};

	api.add(rules);

	return api;
};

