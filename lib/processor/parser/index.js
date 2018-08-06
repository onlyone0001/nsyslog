const
	extend = require("extend"),
	fs = require("fs-extra"),
	Processor = require("../"),
	StateMachine = require("./sm"),
	jsexpr = require("jsexpr");

const DEF_CONF = {
	path : `${__dirname}/generic.json`,
	multi : false,
	cores : 0,
	input : "${originalMessage}",
	output : "parsed"
}

class ParserProcessor extends Processor {
	constructor(id) {
		super(id);
	}

	configure(config,callback) {
		this.config = extend({},DEF_CONF,config);
		this.path = this.config.path;
		this.cores = this.config.cores;
		this.multi = this.config.multi;
		this.map = this.config.map;
		this.singleval = this.config.singleval;
		this.input = jsexpr.expr(this.config.input);
		this.output = jsexpr.assign(this.config.output)
		callback();
	}

	async start(callback) {
		let file = await fs.readFile(this.path,'utf-8');
		let ruleset = JSON.parse(file);

		this.sm = new StateMachine(ruleset,this.multi);

		callback();
	}

	process(entry,callback) {
		let msg = this.input(entry);
		let parsed = this.sm.parse(msg);
		if(this.map) {
			let map = {};
			parsed.forEach(item=>{
				map[item.name] = map[item.name] || [];
				map[item.name].push(item.value);
			});
			if(this.singleval) {
				Object.keys(map).forEach(key=>{
					map[key] = map[key][0];
				});
			}
			parsed = map;
		}
		this.output(entry,parsed);
		callback(null,entry);
	}
}

module.exports = ParserProcessor;