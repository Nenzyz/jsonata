/**
 * © Copyright IBM Corp. 2016, 2018 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 * 
 * 
 * 
 * More about here: http://crockford.com/javascript/tdop/tdop.html
 */

var parseSignature = require('./signature');
var utils = require('./utils');

const parser = (() => {
    'use strict';

    var operators = {
        '.': 75,
        '[': 80,
        ']': 0,
        '{': 70,
        '}': 0,
        '?{': 70,
        '}?': 0,
        '(': 80,
        ')': 0,
        ',': 0,
        '@': 80,
        '#': 80,
        ';': 80,
        ':': 80,
        '?': 20,
        '+': 50,
        '-': 50,
        '*': 60,
        '/': 60,
        '%': 60,
        '|': 20,
        '=': 40,
        '<': 40,
        '>': 40,
        '^': 40,
        '**': 60,
        '..': 20,
        '::': 10,
        ':=': 10,
        '!=': 40,
        '<=': 40,
        '=<': 40,
        '>=': 40,
        '~>': 40,
        '=>': 80,
        '<~': 40,
        '~X': 40,
        '~=': 40,
        'and': 30,
        '||': 30,
        '#\'': 40,
        'or': 25,
        'in': 40,
        '&': 50,
        '!': 0,   // not an operator, but needed as a stop character for name tokens
        '~': 0   // not an operator, but needed as a stop character for name tokens
    };

    var escapes = {  // JSON string escape sequences - see json.org
        '"': '"',
        '\\': '\\',
        '/': '/',
        'b': '\b',
        'f': '\f',
        'n': '\n',
        'r': '\r',
        't': '\t'
    };

    // Tokenizer (lexer) - invoked by the parser to return one token at a time
    var tokenizer = function (path) {
        var position = 0;
        var length = path.length;

        var create = function (type, value, parameters) {
            var obj = {type: type, value: value, position: position};
            // make possible to extend object where needed
            if (parameters !== undefined) { Object.assign(obj, parameters); }
            return obj;
        };

        var scanRegex = function () {
            // the prefix '/' will have been previously scanned. Find the end of the regex.
            // search for closing '/' ignoring any that are escaped, or within brackets
            var start = position;
            var depth = 0;
            var pattern;
            var flags;
            while (position < length) {
                var currentChar = path.charAt(position);
                if (currentChar === '/' && path.charAt(position - 1) !== '\\' && depth === 0) {
                    // end of regex found
                    pattern = path.substring(start, position);
                    if (pattern === '') {
                        throw {
                            code: "S0301",
                            stack: (new Error()).stack,
                            position: position
                        };
                    }
                    position++;
                    currentChar = path.charAt(position);
                    // flags
                    start = position;
                    while (currentChar === 'i' || currentChar === 'm') {
                        position++;
                        currentChar = path.charAt(position);
                    }
                    flags = path.substring(start, position) + 'g';
                    return new RegExp(pattern, flags);
                }
                if ((currentChar === '(' || currentChar === '[' || currentChar === '{') && path.charAt(position - 1) !== '\\') {
                    depth++;
                }
                if ((currentChar === ')' || currentChar === ']' || currentChar === '}') && path.charAt(position - 1) !== '\\') {
                    depth--;
                }

                position++;
            }
            throw {
                code: "S0302",
                stack: (new Error()).stack,
                position: position
            };
        };

        var next = function (prefix) {
            if (position >= length) return null;
            var currentChar = path.charAt(position);
            // skip whitespace
            while (position < length && ' \t\n\r\v'.indexOf(currentChar) > -1) {
                position++;
                currentChar = path.charAt(position);
            }
            // skip single line comment
            if (currentChar === '/' && path.charAt(position + 1) === '/') {
                position += 2;
                currentChar = path.charAt(position);
                while ('\n'.indexOf(currentChar) === -1) {
                    currentChar = path.charAt(++position);
                    if (position >= length) {
                        break;
                    }
                }
                return next(prefix); // need this to swallow any following whitespace
            }
            // eja doc creates 'comment' node
            if (currentChar === '/' && path.charAt(position + 1) === '*' && path.charAt(position + 2) === '*') {
                // ejadocs
                var docStart = position;
                position += 2;
                currentChar = path.charAt(position);
                while (!(currentChar === '*' && path.charAt(position + 1) === '/')) {
                    currentChar = path.charAt(++position);
                    if (position >= length) {
                        // no closing tag
                        throw {
                            code: "S0106",
                            stack: (new Error()).stack,
                            position: docStart
                        };
                    }
                }
                position += 2;
                // need this to swallow any following whitespace
                currentChar = path.charAt(position);
                while (position < length && ' \t\n\r\v'.indexOf(currentChar) > -1) {
                    position++;
                    currentChar = path.charAt(position);
                }
                return create('comment', path.substring(docStart, position));
            }
            // skip comments
            if (currentChar === '/' && path.charAt(position + 1) === '*') {
                var commentStart = position;
                position += 2;
                currentChar = path.charAt(position);
                while (!(currentChar === '*' && path.charAt(position + 1) === '/')) {
                    currentChar = path.charAt(++position);
                    if (position >= length) {
                        // no closing tag
                        throw {
                            code: "S0106",
                            stack: (new Error()).stack,
                            position: commentStart
                        };
                    }
                }
                position += 2;
                currentChar = path.charAt(position);
                return next(prefix); // need this to swallow any following whitespace
            }
            // test for regex
            if (prefix !== true && currentChar === '/') {
                position++;
                return create('regex', scanRegex());
            }
            // handle double-char operators
            if (currentChar === '.' && path.charAt(position + 1) === '.') {
                // double-dot .. range operator
                position += 2;
                return create('operator', '..');
            }
            if (currentChar === ':' && path.charAt(position + 1) === '=') {
                // := assignment
                position += 2;
                return create('operator', ':=');
            }
            if (currentChar === '!' && path.charAt(position + 1) === '=') {
                // !=
                position += 2;
                return create('operator', '!=');
            }
            if (currentChar === '>' && path.charAt(position + 1) === '=') {
                // >=
                position += 2;
                return create('operator', '>=');
            }
            if (currentChar === '<' && path.charAt(position + 1) === '=') {
                // <=
                position += 2;
                return create('operator', '<=');
            }
            if (currentChar === '=' && path.charAt(position + 1) === '<') {
                // <=
                position += 2;
                return create('operator', '<=');
            }
            if (currentChar === '*' && path.charAt(position + 1) === '*') {
                // **  descendant wildcard
                position += 2;
                return create('operator', '**');
            }
            if (currentChar === '~' && path.charAt(position + 1) === '>') {
                // ~>  chain function
                position += 2;
                return create('operator', '~>');
            }
            if (currentChar === ':' && path.charAt(position + 1) === ':') {
                // :: association assignment
                position += 2;
                return create('operator', '::');
            }
            if (currentChar === '<' && path.charAt(position + 1) === '~') {
                // <~  chain / change function, opposite done in ast_optimize
                position += 2;
                return create('operator', '<~');
            }
            if (currentChar === '~' && path.charAt(position + 1) === 'X') {
                // ~X  deletion function
                position += 2;
                return create('operator', '~X');
            }
            if (currentChar === '|' && path.charAt(position + 1) === '|') {
                // ||  chain function
                position += 2;
                return create('operator', '||');
            }
            if (currentChar === '?' && path.charAt(position + 1) === '{') {
                // ?{  switch open tag
                position += 2;
                return create('operator', '?{');
            }
            if (currentChar === '}' && path.charAt(position + 1) === '?') {
                // }?  switch close tag
                position += 2;
                return create('operator', '}?');
            }
            if (currentChar === '=' && path.charAt(position + 1) === '>') {
                // =>  switch <case> => <case body>
                position += 2;
                return create('operator', '=>');
            }
            if (currentChar === '#' && ( path.charAt(position + 1) === "'" || path.charAt(position + 1) === '"' ||path.charAt(position + 1) === "`" )) {
                // #` association ref function
                position += 1;
                return create('operator', "#'");
            }
            if (currentChar === '#' && path.charAt(position+1) !== "" &&  /[a-z]/.exec(path.charAt(position+1) !== null) ) {
                // # erlang function
                var e = position + 1;
                var ech;
                for (; ;) {
                    ech = path.charAt(e);
                    if (e === length || ' \t\n\r\v'.indexOf(ech) > -1 ||  ( operators.hasOwnProperty(ech) && ech !== ":")) {
                        var ename = path.substring(position, e);
                        position = e;
                        return create('variable', ename);
                    } else {
                        e++;
                    }
                }
            }
            // TODO atoms is impossible to implement because of {"payload":false}
            // if (currentChar === ':' && path.charAt(position+1) !== "" &&  Boolean(/[a-z]/.exec(path.charAt(position+1))) ) {
            //     // atom expression
            //     var x = position + 1;
            //     var ach;
            //     for (; ;) {
            //         ach = path.charAt(x);
            //         if (x === length || ' \t\n\r\v'.indexOf(ach) > -1 || operators.hasOwnProperty(ach)) {
            //             var aname = path.substring(position + 1, x);
            //             position = x;
            //             return create('atom', aname);
            //         } else {
            //             x++;
            //         }
            //     }
            // }
            if (currentChar === '~' && path.charAt(position + 1) === '=') {
                // ~= match function call
                position += 2;
                return create('operator', '~=');
            }
            // test for single char operators
            if (Object.prototype.hasOwnProperty.call(operators, currentChar)) {
                position++;
                return create('operator', currentChar);
            }
            // test for string literals
            if (currentChar === '"' || currentChar === "'") {
                var quoteType = currentChar;
                // double quoted string literal - find end of string
                position++;
                var qstr = "";
                while (position < length) {
                    currentChar = path.charAt(position);
                    if (currentChar === '\\') { // escape sequence
                        position++;
                        currentChar = path.charAt(position);
                        if (Object.prototype.hasOwnProperty.call(escapes, currentChar)) {
                            qstr += escapes[currentChar];
                        } else if (currentChar === 'u') {
                            // \u should be followed by 4 hex digits
                            var octets = path.substr(position + 1, 4);
                            if (/^[0-9a-fA-F]+$/.test(octets)) {
                                var codepoint = parseInt(octets, 16);
                                qstr += String.fromCharCode(codepoint);
                                position += 4;
                            } else {
                                throw {
                                    code: "S0104",
                                    stack: (new Error()).stack,
                                    position: position
                                };
                            }
                        } else {
                            // illegal escape sequence
                            throw {
                                code: "S0103",
                                stack: (new Error()).stack,
                                position: position,
                                token: currentChar
                            };

                        }
                    } else if (currentChar === quoteType) {
                        position++;
                        return create('string', qstr);
                    } else {
                        qstr += currentChar;
                    }
                    position++;
                }
                throw {
                    code: "S0101",
                    stack: (new Error()).stack,
                    position: position
                };
            }
            // test for numbers
            var numregex = /^-?(0|([1-9][0-9]*))(\.[0-9]+)?([Ee][-+]?[0-9]+)?/;
            var match = numregex.exec(path.substring(position));
            if (match !== null) {
                var num = parseFloat(match[0]);
                if (!isNaN(num) && isFinite(num)) {
                    position += match[0].length;
                    return create('number', num);
                } else {
                    throw {
                        code: "S0102",
                        stack: (new Error()).stack,
                        position: position,
                        token: match[0]
                    };
                }
            }
            // test for quoted names (backticks)
            var name;
            if (currentChar === '`') {
                // scan for closing quote
                position++;
                var end = path.indexOf('`', position);
                if (end !== -1) {
                    name = path.substring(position, end);
                    // Special case for `template strings` of JavaScript
                    if (name.indexOf("${", position) != -1) {
                        var neo_name = `\`${name}\``.replace(/\${([^}]+)}/g, "` %separator% ( $1 ) %separator% `");

                        var neo_parts = [];
                        neo_name.split(" %separator% ").forEach(
                            function(i){
                                if(i[0] == "`") {
                                    var clear_i = i.substr(1, i.length - 2);
                                    var qqindx = clear_i.indexOf('"');
                                    var qindx = clear_i.indexOf("'");
                                    if (qqindx != -1 || qindx != -1) {
                                        if(qqindx != -1 && qindx != -1 && qqindx > qindx) {
                                            clear_i = `"${clear_i}"`;
                                        }
                                        if(qqindx != -1 && qindx != -1 && qqindx < qindx) {
                                            clear_i = `'${clear_i}'`;
                                        }
                                    } if (qqindx != -1) {
                                        clear_i = `'${clear_i}'`;
                                    // } if (qindx != -1) {
                                    //     clear_i = `"${clear_i}"`;
                                    } else {
                                        clear_i = `"${clear_i}"`;
                                    }
                                    neo_parts.push(clear_i);
                                }else{
                                    neo_parts.push(i);
                                }
                            }
                        );

                        neo_name = neo_parts.join(" & ");

                        path = path.replace(`\`${name}\``, neo_name);
                        length = path.length;
                        
                        var tname = neo_parts[0].substr(1, neo_parts[0].length - 2);
                        if (tname.length != name.length) {
                            position = position + tname.length + 1;
                            return create('string', tname);
                        }
                    }
                    position = end + 1;
                    return create('name', name);
                }
                position = length;
                throw {
                    code: "S0105",
                    stack: (new Error()).stack,
                    position: position
                };
            }
            // test for names
            var i = position;
            var ch;
            for (; ;) {
                ch = path.charAt(i);
                if (i === length || ' \t\n\r\v'.indexOf(ch) > -1 || Object.prototype.hasOwnProperty.call(operators, ch)) {
                    if (path.charAt(position) === '$') {
                        // variable reference
                        name = path.substring(position + 1, i);
                        position = i;
                        return create('variable', name);
                    } else {
                        name = path.substring(position, i);
                        position = i;
                        if (path.charAt(i) === ':' && path.charAt(i+1) === ':' ) {
                            // process so-called variable for eja libs ie. "system::date()"
                            var i2 = i + 2;
                            var ch2;
                            var name2 = "";
                            for (; ;) {
                                ch2 = path.charAt(i2);
                                if (i2 === length || ' \t\n\r\v'.indexOf(ch2) > -1 || operators.hasOwnProperty(ch2)) {
                                    name2 = path.substring(i + 2, i2);
                                    position = i2;
                                    break;
                                } else {
                                    i2++;
                                }
                            }
                            return create('name', name + "::" + name2, {mode: 'lib'});
                        }
                        switch (name) {
                            case 'or':
                            case '||':
                            case 'in':
                            case 'and':
                                return create('operator', name);
                            case 'true':
                                return create('value', true);
                            case 'false':
                                return create('value', false);
                            case 'null':
                                return create('value', null);
                            default:
                                if (position === length && name === '') {
                                    // whitespace at end of input
                                    return null;
                                }
                                return create('name', name);
                        }
                    }
                } else {
                    i++;
                }
            }
        };

        return next;
    };

    // This parser implements the 'Top down operator precedence' algorithm developed by Vaughan R Pratt; http://dl.acm.org/citation.cfm?id=512931.
    // and builds on the Javascript framework described by Douglas Crockford at http://javascript.crockford.com/tdop/tdop.html
    // and in 'Beautiful Code', edited by Andy Oram and Greg Wilson, Copyright 2007 O'Reilly Media, Inc. 798-0-596-51004-6

    var parser = function (source, recover) {
        var node;
        var lexer;

        var symbol_table = {};
        var errors = [];

        var remainingTokens = function () {
            var remaining = [];
            if (node.id !== '(end)') {
                remaining.push({type: node.type, value: node.value, position: node.position});
            }
            var nxt = lexer();
            while (nxt !== null) {
                remaining.push(nxt);
                nxt = lexer();
            }
            return remaining;
        };

        var base_symbol = {
            nud: function () {
                // error - symbol has been invoked as a unary operator
                var err = {
                    code: 'S0211',
                    token: this.value,
                    position: this.position
                };

                if (recover) {
                    err.remaining = remainingTokens();
                    err.type = 'error';
                    errors.push(err);
                    return err;
                } else {
                    err.stack = (new Error()).stack;
                    throw err;
                }
            }
        };

        var symbol = function (id, bp) {
            var s = symbol_table[id];
            bp = bp || 0;
            if (s) {
                if (bp >= s.lbp) {
                    s.lbp = bp;
                }
            } else {
                s = Object.create(base_symbol);
                s.id = s.value = id;
                s.lbp = bp;
                symbol_table[id] = s;
            }
            return s;
        };

        var handleError = function (err) {
            if (recover) {
                // tokenize the rest of the buffer and add it to an error token
                err.remaining = remainingTokens();
                errors.push(err);
                var symbol = symbol_table["(error)"];
                node = Object.create(symbol);
                node.error = err;
                node.type = "(error)";
                return node;
            } else {
                err.stack = (new Error()).stack;
                throw err;
            }
        };

        var advance = function (id, infix) {
            if (id && node.id !== id) {
                var code;
                if (node.id === '(end)') {
                    // unexpected end of buffer
                    code = "S0203";
                } else {
                    code = "S0202";
                }
                var err = {
                    code: code,
                    position: node.position,
                    token: node.value,
                    value: id
                };
                return handleError(err);
            }
            var next_token = lexer(infix);
            if (next_token === null) {
                node = symbol_table["(end)"];
                node.position = source.length;
                return node;
            }
            var value = next_token.value;
            var type = next_token.type;
            var symbol;
            switch (type) {
                case 'name':
                case 'atom':
                case 'variable':
                    symbol = symbol_table["(name)"];
                    break;
                case 'operator':
                    symbol = symbol_table[value];
                    if (!symbol) {
                        return handleError({
                            code: "S0204",
                            stack: (new Error()).stack,
                            position: next_token.position,
                            token: value
                        });
                    }
                    break;
                case 'comment':
                case 'string':
                case 'number':
                case 'value':
                    symbol = symbol_table["(literal)"];
                    break;
                case 'regex':
                    type = "regex";
                    symbol = symbol_table["(regex)"];
                    break;
                /* istanbul ignore next */
                default:
                    return handleError({
                        code: "S0205",
                        stack: (new Error()).stack,
                        position: next_token.position,
                        token: value
                    });
            }

            node = Object.create(symbol);
            node.value = value;
            node.type = type;
            // some nodes using "mode" for classification
            if (next_token.mode) { node.mode = next_token.mode; }
            node.position = next_token.position;
            return node;
        };

        // Pratt's algorithm
        var expression = function (rbp) {
            var left;
            var t = node;
            advance(null, true);
            left = t.nud();
            while (rbp < node.lbp) {
                t = node;
                advance();
                left = t.led(left);
            }
            return left;
        };

        var terminal = function (id) {
            var s = symbol(id, 0);
            s.nud = function () {
                return this;
            };
        };

        // match infix operators
        // <expression> <operator> <expression>
        // left associative
        var infix = function (id, bp, led) {
            var bindingPower = bp || operators[id];
            var s = symbol(id, bindingPower);
            s.led = led || function (left) {
                this.lhs = left;
                this.rhs = expression(bindingPower);
                this.type = "binary";
                return this;
            };
            return s;
        };

        // match infix operators
        // <expression> <operator> <expression>
        // right associative
        var infixr = function (id, bp, led) {
            var s = symbol(id, bp);
            s.led = led;
            return s;
        };

        // match prefix operators
        // <operator> <expression>
        var prefix = function (id, nud) {
            var s = symbol(id);
            s.nud = nud || function () {
                this.expression = expression(70);
                this.type = "unary";
                return this;
            };
            return s;
        };

        // match postfix operators
        // <expression> <operator>
        var suffix = function (id, bp, led) {
            var bindingPower = bp || operators[id];
            var s = symbol(id, bindingPower);
            s.led = led || function (left) {
                this.expression = left;
                this.type = "binary";
                return this;
            };
            return s;
        };

        terminal("(end)");
        terminal("(atom)");
        terminal("(name)");
        terminal("(literal)");
        terminal("(regex)");
        symbol(":");
        symbol(";");
        symbol(",");
        symbol(")");
        symbol("]");
        symbol("}");
        symbol(".."); // range operator
        infix("."); // field reference
        infix("+"); // numeric addition
        infix("-"); // numeric subtraction
        infix("*"); // numeric multiplication
        infix("/"); // numeric division
        infix("%"); // numeric modulus
        infix("="); // equality
        infix("<"); // less than
        infix(">"); // greater than
        infix("!="); // not equal to
        infix("<="); // less than or equal
        infix(">="); // greater than or equal
        infix("&"); // string concatenation
        infix("and"); // Boolean AND
        infix("or"); // Boolean OR
        infix("in"); // is member of array
        terminal("and"); // the 'keywords' can also be used as terminals (field names)
        terminal("or"); //
        terminal("in"); //
        prefix("-"); // unary numeric negation
        infix("~>"); // function application / path setup
        // prefix(":"); // tuple
        symbol("?{"); // switch open tag
        symbol("}?"); // switch close tag
        symbol("=>"); // sign for switch
        infix("||"); // JS undefined || ...
        infix("<~"); // path setup
        suffix("~X"); // path deletion
        infix("~="); // match function

        infixr("(error)", 10, function (left) {
            this.lhs = left;

            this.error = node.error;
            this.remaining = remainingTokens();
            this.type = 'error';
            return this;
        });

        // field wildcard (single level)
        prefix('*', function () {
            this.type = "wildcard";
            return this;
        });

        // descendant wildcard (multi-level)
        prefix('**', function () {
            this.type = "descendant";
            return this;
        });

        // function invocation
        infix("(", operators['('], function (left) {
            // left is is what we are trying to invoke
            this.procedure = left;
            this.type = 'function';
            this.arguments = [];
            if (node.id !== ')') {
                for (; ;) {
                    if (node.type === 'operator' && node.id === '?') {
                        // partial function application
                        this.type = 'partial';
                        this.arguments.push(node);
                        advance('?');
                    } else {
                        this.arguments.push(expression(0));
                    }
                    if (node.id !== ',') break;
                    advance(',');
                }
            }
            advance(")", true);
            // if the name of the function is 'function' or λ, then this is function definition (lambda function)
            if (node.id === "{") { // if using a function call such as "system::date()" no need to form an function declaration
                if (left.type === 'name' && ((left.value === 'function' || left.value === 'fun' ||left.value === '\u03BB' || left.value === '\u0192' ) || left.mode === 'lib' ) ) {
                    // all of the args must be VARIABLE tokens
                    this.arguments.forEach(function (arg, index) {
                        if (arg.type !== 'variable' && left.mode !== 'lib') {
                            return handleError({
                                code: "S0208",
                                stack: (new Error()).stack,
                                position: arg.position,
                                token: arg.value,
                                value: index + 1
                            });
                        }
                    });
                    this.type = 'lambda';
                    // is the next token a '<' - if so, parse the function signature
                    if (node.id === '<') {
                        var sigPos = node.position;
                        var depth = 1;
                        var sig = '<';
                        while (depth > 0 && node.id !== '{' && node.id !== '(end)') {
                            var tok = advance();
                            if (tok.id === '>') {
                                depth--;
                            } else if (tok.id === '<') {
                                depth++;
                            }
                            sig += tok.value;
                        }
                        advance('>');
                        try {
                            this.signature = parseSignature(sig);
                        } catch (err) {
                            // insert the position into this error
                            err.position = sigPos + err.offset;
                            return handleError(err);
                        }
                    }
                    // parse the function body
                    advance('{');
                    var expressions = [];
                    while (node.id !== "}") {
                        var n = expression(0);
                        expressions.push(n);
                        if (node.id !== ";") {
                            break;
                        }
                        advance(";");
                    }
                    advance('}');
                    this.body = { type: 'block', expressions: expressions };
                }
            }
            return this;
        });

        // parenthesis - block expression
        prefix("(", function () {
            var expressions = [];
            while (node.id !== ")") {
                var expr = expression(0);
                expressions.push(expr);
                if (node.id !== ";" && expr.type !== "comment") {
                    break;
                }
                if (expr.type !== "comment") {advance(";");}
            }
            advance(")", true);
            this.type = 'block';
            this.expressions = expressions;
            return this;
        });

        // questionmark curly parenthesis - switch block expression
        prefix("?{", function () {
            var expressions = [];
            while (node.id !== "}?") {
                var expr = expression(0);
                if (node.id !== ";" && node.id !== "=>") {
                    break;
                }
                if (node.id === ";") {
                    expressions.push({value: expr});
                    advance(";");
                } else if (node.id === "=>") {
                    advance("=>");
                    var then = expression(0);
                    expressions.push({expr, then, next:  node.id === "," ? "continue" : undefined});
                    if (node.id !== ";" && node.id !== ",") {
                        break;
                    }
                    advance(node.id);
                }
            }
            advance("}?", true);
            this.type = 'switch';
            this.expressions = expressions;
            return this;
        });

        // association reference
        prefix("#'");

        // association assign
        infixr("::", operators['::'], function (left) {
            if (left.type !== 'string' && left.type !== 'name') {
                return handleError({
                    code: "S0212",
                    stack: (new Error()).stack,
                    position: left.position,
                    token: left.value
                });
            }
            this.lhs = left;
            this.rhs = expression(operators['::'] - 1); // subtract 1 from bindingPower for right associative operators
            this.type = "binary";
            return this;
        });

        // array constructor
        prefix("[", function () {
            var a = [];
            if (node.id !== "]") {
                for (; ;) {
                    var item = expression(0);
                    if (node.id === "..") {
                        // range operator
                        var range = {type: "binary", value: "..", position: node.position, lhs: item};
                        advance("..");
                        range.rhs = expression(0);
                        item = range;
                    }
                    a.push(item);
                    if (node.id !== ",") {
                        break;
                    }
                    advance(",");
                }
            }
            advance("]", true);
            this.expressions = a;
            // TODO tuple can't be formed with :[...] due to symbol nature of ":"
            // this.atom = left;
            this.type = "unary";
            return this;
        });

        // filter - predicate or array index
        infix("[", operators['['], function (left) {
            if (node.id === "]") {
                // empty predicate means maintain singleton arrays in the output
                var step = left;
                while (step && step.type === 'binary' && step.value === '[') {
                    step = step.lhs;
                }
                step.keepArray = true;
                advance("]");
                return left;
            } else {
                this.lhs = left;
                this.rhs = expression(operators[']']);
                this.type = 'binary';
                advance("]", true);
                return this;
            }
        });

        // order-by
        infix("^", operators['^'], function (left) {
            advance("(");
            var terms = [];
            for (; ;) {
                var term = {
                    descending: false
                };
                if (node.id === "<") {
                    // ascending sort
                    advance("<");
                } else if (node.id === ">") {
                    // descending sort
                    term.descending = true;
                    advance(">");
                } else {
                    //unspecified - default to ascending
                }
                term.expression = expression(0);
                terms.push(term);
                if (node.id !== ",") {
                    break;
                }
                advance(",");
            }
            advance(")");
            this.lhs = left;
            this.rhs = terms;
            this.type = 'binary';
            return this;
        });

        var objectParser = function (left) {
            var a = [];
            if (node.id !== "}") {
                for (; ;) {
                    var n = expression(0);
                    advance(":");
                    var v = expression(0);
                    a.push([n, v]); // holds an array of name/value expression pairs
                    if (node.id !== ",") {
                        break;
                    }
                    advance(",");
                }
            }
            advance("}", true);
            if (typeof left === 'undefined') {
                // NUD - unary prefix form
                this.lhs = a;
                this.type = "unary";
            } else {
                // LED - binary infix form
                this.lhs = left;
                this.rhs = a;
                this.type = 'binary';
            }
            return this;
        };

        // object constructor
        prefix("{", objectParser);

        // object grouping
        infix("{", operators['{'], objectParser);

        // bind variable
        infixr(":=", operators[':='], function (left) {
            if (left.type !== 'variable') {
                return handleError({
                    code: "S0212",
                    stack: (new Error()).stack,
                    position: left.position,
                    token: left.value
                });
            }
            this.lhs = left;
            this.rhs = expression(operators[':='] - 1); // subtract 1 from bindingPower for right associative operators
            this.type = "binary";
            return this;
        });

        // focus variable bind
        infix("@", operators['@'], function (left) {
            this.lhs = left;
            this.rhs = expression(operators['@']);
            if(this.rhs.type !== 'variable') {
                return handleError({
                    code: "S0214",
                    stack: (new Error()).stack,
                    position: this.rhs.position,
                    token: "@"
                });
            }
            this.type = "binary";
            return this;
        });

        // index (position) variable bind
        infix("#", operators['#'], function (left) {
            this.lhs = left;
            this.rhs = expression(operators['#']);
            if(this.rhs.type !== 'variable') {
                return handleError({
                    code: "S0214",
                    stack: (new Error()).stack,
                    position: this.rhs.position,
                    token: "#"
                });
            }
            this.type = "binary";
            return this;
        });

        // if/then/else ternary operator ?:
        infix("?", operators['?'], function (left) {
            this.type = 'condition';
            this.condition = left;
            this.then = expression(0);
            if (node.id === ':') {
                // else condition
                advance(":");
                this.else = expression(0);
            }
            return this;
        });

        // object transformer
        prefix("|", function () {
            this.type = 'transform';
            this.pattern = expression(0);
            advance('|');
            this.update = expression(0);
            if (node.id === ',') {
                advance(',');
                this.delete = expression(0);
            }
            advance('|');
            return this;
        });

        // tail call optimization
        // this is invoked by the post parser to analyse lambda functions to see
        // if they make a tail call.  If so, it is replaced by a thunk which will
        // be invoked by the trampoline loop during function application.
        // This enables tail-recursive functions to be written without growing the stack
        var tail_call_optimize = function (expr) {
            var result;
            if (expr.type === 'function' && !expr.predicate) {
                var thunk = {type: 'lambda', thunk: true, arguments: [], position: expr.position};
                thunk.body = expr;
                result = thunk;
            } else if (expr.type === 'condition') {
                // analyse both branches
                expr.then = tail_call_optimize(expr.then);
                if (typeof expr.else !== 'undefined') {
                    expr.else = tail_call_optimize(expr.else);
                }
                result = expr;
            } else if (expr.type === 'block') {
                // only the last expression in the block
                var length = expr.expressions.length;
                if (length > 0) {
                    expr.expressions[length - 1] = tail_call_optimize(expr.expressions[length - 1]);
                }
                result = expr;
            } else {
                result = expr;
            }
            return result;
        };

        // post-parse stage
        // the purpose of this is flatten the parts of the AST representing location paths,
        // converting them to arrays of steps which in turn may contain arrays of predicates.
        // following this, nodes containing '.' and '[' should be eliminated from the AST.
        var ast_optimize = function (expr) {
            var result;
            // console.log("ast_optimize: ", expr);
            switch (expr.type) {
                case 'binary':
                    switch (expr.value) {
                        case '.':
                            var lstep = ast_optimize(expr.lhs);
                            result = {type: 'path', steps: []};
                            if (lstep.type === 'path') {
                                Array.prototype.push.apply(result.steps, lstep.steps);
                            } else {
                                result.steps = [lstep];
                            }
                            var rest = ast_optimize(expr.rhs);
                            if (rest.type === 'function' &&
                                rest.procedure.type === 'path' &&
                                rest.procedure.steps.length === 1 &&
                                rest.procedure.steps[0].type === 'name' &&
                                result.steps[result.steps.length - 1].type === 'function') {
                                // next function in chain of functions - will override a thenable
                                result.steps[result.steps.length - 1].nextFunction = rest.procedure.steps[0].value;
                            }
                            if (rest.type !== 'path') {
                                if(typeof rest.predicate !== 'undefined') {
                                    rest.stages = rest.predicate;
                                    delete rest.predicate;
                                }
                                rest = {type: 'path', steps: [rest]};
                            }
                            Array.prototype.push.apply(result.steps, rest.steps);
                            // any steps within a path that are string literals, should be changed to 'name'
                            result.steps.filter(function (step) {
                                if (step.type === 'number' || step.type === 'value') {
                                    // don't allow steps to be numbers or the values true/false/null
                                    throw {
                                        code: "S0213",
                                        stack: (new Error()).stack,
                                        position: step.position,
                                        value: step.value
                                    };
                                }
                                return step.type === 'string';
                            }).forEach(function (lit) {
                                lit.type = 'name';
                            });
                            // any step that signals keeping a singleton array, should be flagged on the path
                            if (result.steps.filter(function (step) {
                                return step.keepArray === true;
                            }).length > 0) {
                                result.keepSingletonArray = true;
                            }
                            // if first step is a path constructor, flag it for special handling
                            var firststep = result.steps[0];
                            if (firststep.type === 'unary' && firststep.value === '[') {
                                firststep.consarray = true;
                            }
                            // if the last step is an array constructor, flag it so it doesn't flatten
                            var laststep = result.steps[result.steps.length - 1];
                            if (laststep.type === 'unary' && laststep.value === '[') {
                                laststep.consarray = true;
                            }
                            break;
                        case '[':
                            // predicated step
                            // LHS is a step or a predicated step
                            // RHS is the predicate expr
                            result = ast_optimize(expr.lhs);
                            var step = result;
                            var type = 'predicate';
                            if (result.type === 'path') {
                                step = result.steps[result.steps.length - 1];
                                type = 'stages';
                            }
                            if (typeof step.group !== 'undefined') {
                                throw {
                                    code: "S0209",
                                    stack: (new Error()).stack,
                                    position: expr.position
                                };
                            }
                            if (typeof step[type] === 'undefined') {
                                step[type] = [];
                            }
                            step[type].push({type: 'filter', expr: ast_optimize(expr.rhs), position: expr.position});
                            break;
                        case '{':
                            // group-by
                            // LHS is a step or a predicated step
                            // RHS is the object constructor expr
                            result = ast_optimize(expr.lhs);
                            if (typeof result.group !== 'undefined') {
                                throw {
                                    code: "S0210",
                                    stack: (new Error()).stack,
                                    position: expr.position
                                };
                            }
                            // object constructor - process each pair
                            result.group = {
                                lhs: expr.rhs.map(function (pair) {
                                    return [ast_optimize(pair[0]), ast_optimize(pair[1])];
                                }),
                                position: expr.position
                            };
                            break;
                        case '^':
                            // order-by
                            // LHS is the array to be ordered
                            // RHS defines the terms
                            result = ast_optimize(expr.lhs);
                            var tms = expr.rhs.map(function (terms) {
                                return {
                                    descending: terms.descending,
                                    expression: ast_optimize(terms.expression)
                                };
                            });
                            if (result.type !== 'path') {
                                result = {type: 'path', steps: [result]};
                            }
                            result.steps.push({type: 'sort', terms: tms, position: expr.position});
                            break;
                        case ':=':
                            result = {type: 'bind', value: expr.value, position: expr.position};
                            result.lhs = ast_optimize(expr.lhs);
                            result.rhs = ast_optimize(expr.rhs);
                            break;
                        case '@':
                            result = ast_optimize(expr.lhs);
                            step = result;
                            if (result.type === 'path') {
                                step = result.steps[result.steps.length - 1];
                            }
                            // throw error if there are any predicates defined at this point
                            // at this point the only type of stages can be predicates
                            if(typeof step.stages !== 'undefined') {
                                throw {
                                    code: "S0215",
                                    stack: (new Error()).stack,
                                    position: expr.position
                                };
                            }
                            // also throw if this is applied after an 'order-by' clause
                            if(step.type === 'sort') {
                                throw {
                                    code: "S0216",
                                    stack: (new Error()).stack,
                                    position: expr.position
                                };
                            }
                            if(expr.keepArray) {
                                step.keepArray = true;
                            }
                            step.focus = expr.rhs.value;
                            step.tuple = true;
                            break;
                        case '#':
                            result = ast_optimize(expr.lhs);
                            step = result;
                            if (result.type === 'path') {
                                step = result.steps[result.steps.length - 1];
                            }
                            if (typeof step.stages === 'undefined') {
                                step.index = expr.rhs.value;
                            } else {
                                step.stages.push({type: 'index', value: expr.rhs.value, position: expr.position});
                            }
                            step.tuple = true;
                            break;
                        case '~>':
                            result = { type: 'apply', value: expr.value, position: expr.position };
                            result.lhs = ast_optimize(expr.lhs);
                            result.rhs = ast_optimize(expr.rhs);

                            if (result.rhs.type === 'path' || (result.rhs.type === 'variable' && result.rhs.value === '$')) {
                                if (result.rhs.steps) {
                                    result = result.rhs;
                                    // var last_step = result.steps.pop();
                                    var last_step;
                                    if (result.steps[result.steps.length - 1].stages) {
                                        last_step = {position: -1, type: "variable", value: ""};
                                    } else {
                                        last_step = result.steps.pop();
                                    }
                                    result.steps.map(function(el){
                                        el.create_missing = true;
                                    });
                                    last_step.parsed_parent = utils.flatten(parse_array(result));
                                    var change_block = { type: "block", expressions: [{ type: "change", position: expr.position, value: expr.value, rhs: last_step, lhs: ast_optimize(expr.lhs) }] };
                                    result.steps.push(change_block);
                                    result.mode = 'change';
                                } else {
                                    result.type = 'change';
                                }
                            }
                            break;
                        // CONSTRUCTION YARD
                        case '<~':
                            // The following reformat <expression> <~ <value> into
                            //   <expression before last path>.( <last path> <~ <value> )
                            // This is done due to complexity of change and for filter functionality
                            result = ast_optimize(expr.lhs);
                            if (result.steps) {
                                // var last_step = result.steps.pop();
                                var last_step;
                                if (result.steps[result.steps.length - 1].stages) {
                                    last_step = {position: -1, type: "variable", value: ""};
                                } else {
                                    last_step = result.steps.pop();
                                }
                                result.steps.map(function(el){
                                    el.create_missing = true;
                                });
                                last_step.parsed_parent = utils.flatten(parse_array(result));
                                var change_block = { type: "block", expressions: [{ type: "change", position: expr.position, value: expr.value, lhs: last_step, rhs: ast_optimize(expr.rhs) }] };
                                result.steps.push(change_block);
                                result.mode = 'change';
                            } else {
                                result = {type: 'change', value: expr.value, postion: expr.position};
                                result.lhs = ast_optimize(expr.lhs);
                                result.rhs = ast_optimize(expr.rhs);
                            }
                            break;
                        case '~X':
                            result = ast_optimize(expr.expression);
                            if (result.steps) {
                                var last_step;
                                if (result.steps[result.steps.length - 1].stages) {
                                    last_step = {position: -1, type: "variable", value: ""};
                                } else {
                                    last_step = result.steps.pop();
                                }
                                result.steps.map(function(el){
                                    el.deletion_operation = true;
                                });
                                var change_block = { type: "block", expressions: [{ type: "change", position: expr.position, value: expr.value, expression: last_step }] };
                                result.steps.push(change_block);
                                result.mode = 'change';
                            } else {
                                result = {type: 'change', value: expr.value, postion: expr.position};
                                result.expression = ast_optimize(expr.expression);
                            }
                            break;
                        case '::':
                            result = {type: 'bind', value: expr.value, position: expr.position};
                            var nlhs = ast_optimize(expr.lhs);
                            if (nlhs.type === 'path' && nlhs.steps !== undefined && nlhs.steps.length === 1) {
                                result.lhs = {type: 'variable', value: nlhs.steps[0].value};
                            } else if (nlhs.type === 'string') {
                                result.lhs = {type: 'variable', value: nlhs.value};
                            } else {
                                result.lhs = nlhs;
                            }
                            var thunk = {type: 'lambda', thunk: true, arguments: [], position: expr.position};
                            thunk.body = ast_optimize(expr.rhs);
                            result.rhs = thunk;
                            break;
                        default:
                            result = {type: expr.type, value: expr.value, position: expr.position};
                            result.lhs = ast_optimize(expr.lhs);
                            result.rhs = ast_optimize(expr.rhs);
                    }
                    break;
                case 'unary':
                    result = {type: expr.type, value: expr.value, position: expr.position};
                    if (expr.value === '[') {
                        // array constructor - process each item
                        result.expressions = expr.expressions.map(function (item) {
                            return ast_optimize(item);
                        });
                    } else if (expr.value === "#'") {
                        result = ast_optimize(expr.expression);
                        
                        var nprocedure = {type: 'function', name: expr.name, value: "(", position: expr.position, arguments: [], mode: "backtick"};
                        nprocedure.procedure = result.steps[0];
                        nprocedure.procedure.type = "variable";

                        if (nprocedure.procedure.predicate !== undefined) {
                            nprocedure.predicate = nprocedure.procedure.predicate;
                            delete nprocedure.procedure.predicate;
                        }
                        result.steps[0] = nprocedure;
                    } else if (expr.value === '{') {
                        // object constructor - process each pair
                        result.lhs = expr.lhs.map(function (pair) {
                            return [ast_optimize(pair[0]), ast_optimize(pair[1])];
                        });
                    } else {
                        // all other unary expressions - just process the expression
                        result.expression = ast_optimize(expr.expression);
                        // if unary minus on a number, then pre-process
                        if (expr.value === '-' && result.expression.type === 'number') {
                            result = result.expression;
                            result.value = -result.value;
                        }
                    }
                    break;
                case 'function':
                case 'partial':
                    result = {type: expr.type, name: expr.name, value: expr.value, position: expr.position};
                    result.arguments = expr.arguments.map(function (arg) {
                        return ast_optimize(arg);
                    });
                    var nprocedure = ast_optimize(expr.procedure);
                    if (expr.procedure.mode === 'lib') {
                        result.procedure = expr.procedure;
                        result.procedure.type = 'variable';
                    } else {
                        result.procedure = nprocedure;
                    }
                    // result.procedure = ast_optimize(expr.procedure);
                    break;
                case 'lambda':
                    result = {
                        type: expr.type,
                        arguments: expr.arguments,
                        signature: expr.signature,
                        position: expr.position
                    };
                    if (expr.procedure.mode === undefined || expr.procedure.mode !== 'lib') {
                        var body = ast_optimize(expr.body);
                        result.body = tail_call_optimize(body);
                    } else {
                        result.mode = 'lib';
                        // result.value = expr.procedure.value;
                        result = { type: 'bind', value: ":=", rhs: expr, lhs: { type: 'variable', value: expr.procedure.value } };
                        result.rhs.body = tail_call_optimize(ast_optimize(result.rhs.body));
                    }
                    break;
                case 'condition':
                    result = {type: expr.type, position: expr.position};
                    result.condition = ast_optimize(expr.condition);
                    result.then = ast_optimize(expr.then);
                    if (typeof expr.else !== 'undefined') {
                        result.else = ast_optimize(expr.else);
                    }
                    break;
                case 'transform':
                    result = {type: expr.type, position: expr.position};
                    result.pattern = ast_optimize(expr.pattern);
                    result.update = ast_optimize(expr.update);
                    if (typeof expr.delete !== 'undefined') {
                        result.delete = ast_optimize(expr.delete);
                    }
                    break;
                case 'block':
                    result = {type: expr.type, position: expr.position};
                    // array of expressions - process each one
                    result.expressions = expr.expressions.map(function (item) {
                        var part = ast_optimize(item);
                        if (part.consarray || (part.type === 'path' && part.steps[0].consarray)) {
                            result.consarray = true;
                        }
                        return part;
                    });
                    // TODO scan the array of expressions to see if any of them assign variables
                    // if so, need to mark the block as one that needs to create a new frame
                    break;
                case 'switch':
                    result = {type: expr.type, position: expr.position};
                    // switch expressions
                    result.expressions = expr.expressions.map(function (item) {
                        if (item.value) {
                            // eval value
                            var part_value = ast_optimize(item.value);
                            if (part_value.consarray || (part_value.type === 'path' && part_value.steps[0].consarray)) {
                                result.value.consarray = true;
                            }
                            item.value = part_value;
                        } else {
                            // cases
                            var part_expr = ast_optimize(item.expr);
                            var part_then = ast_optimize(item.then);
                            if (part_expr.consarray || (part_expr.type === 'path' && part_expr.steps[0].consarray)) {
                                result.expr.consarray = true;
                            }
                            if (part_then.consarray || (part_then.type === 'path' && part_then.steps[0].consarray)) {
                                result.then.consarray = true;
                            }
                            item.expr = part_expr;
                            item.then = part_then;
                        }

                        return item;
                    });
                    break;
                case 'name':
                    result = {type: 'path', steps: [expr]};
                    if (expr.keepArray) {
                        result.keepSingletonArray = true;
                    }
                    break;
                case 'string':
                case 'number':
                case 'value':
                case 'wildcard':
                case 'descendant':
                case 'variable':
                case 'regex':
                case 'atom':
                case 'comment':
                case 'path':
                    result = expr;
                    break;
                case 'operator':
                    // the tokens 'and' and 'or' might have been used as a name rather than an operator
                    if (expr.value === 'and' || expr.value === 'or' || expr.value === 'in') {
                        expr.type = 'name';
                        result = ast_optimize(expr);
                    } else /* istanbul ignore else */ if (expr.value === '?') {
                        // partial application
                        result = expr;
                    } else {
                        throw {
                            code: "S0201",
                            stack: (new Error()).stack,
                            position: expr.position,
                            token: expr.value
                        };
                    }
                    break;
                case 'error':
                    result = expr;
                    if (expr.lhs) {
                        result = ast_optimize(expr.lhs);
                    }
                    break;
                default:
                    var code = "S0206";
                    /* istanbul ignore else */
                    if (expr.id === '(end)') {
                        code = "S0207";
                    }
                    var err = {
                        code: code,
                        position: expr.position,
                        token: expr.value
                    };
                    if (recover) {
                        errors.push(err);
                        return {type: 'error', error: err};
                    } else {
                        err.stack = (new Error()).stack;
                        throw err;
                    }
            }
            if (expr.keepArray) {
                result.keepArray = true;
            }
            return result;
        };

        // now invoke the tokenizer and the parser and return the syntax tree
        lexer = tokenizer(source);
        advance();
        // parse the tokens
        var expr = expression(0);
        if (node.id !== '(end)') {
            var err = {
                code: "S0201",
                position: node.position,
                token: node.value
            };
            handleError(err);
        }
        expr = ast_optimize(expr);

        if (errors.length > 0) {
            expr.errors = errors;
        }

        // console.log("AST: ", expr);
        return expr;
    };

    var parse_array = function (el) {
        if (el.type !== undefined && el.type === "path") {
            return el.steps.map(parse_array);
        }

        var output = [el.value];
        if (el.value !== undefined && el.value === "$") {
            output = ["input"];
        }

        if (el.predicate !== undefined && el.predicate[0] !== undefined) {
            // output = output + "[" + el.predicate[0].value + "]";
            output.push(el.predicate[0].value);
        }
        if (el.stages !== undefined && el.stages[0] !== undefined && el.stages[0].value !== undefined) {
            // output = output + "[" + el.predicate[0].value + "]";
            var v_value = typeof el.stages[0].value;
            if (v_value == "number" || v_value == "string") output.push(el.stages[0].value);
        } else if (el.stages !== undefined && el.stages[0] !== undefined && el.stages[0].value == undefined) {
            var v_value = typeof el.stages[0].value;
            if (v_value == "number" || v_value == "string") output.push(el.stages[0].expr.value);
        }

        var rest = [];
        if (el.steps !== undefined) {
            rest = el.steps.map(parse_array);
        }

        if (rest !== []) {
            return output.concat(rest);
        }

        return output;
    };

    return parser;
})();

module.exports = parser;
