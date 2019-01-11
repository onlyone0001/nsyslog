const
	extend = require("extend"),
	Processor = require("./"),
	logger = require("../logger"),
	fs = require("fs-extra"),
	Path = require('path'),
	jsexpr = require("jsexpr");

const DEF_CONF = {
	map : {},
	file : null,
	fields : []
}

class TranslateProcessor extends Processor {
	constructor(id,type) {
		super(id,type);
	}

	async configure(config,callback) {
		this.config = extend({},DEF_CONF,config);
		this.map = this.config.map;

		this.fields = this.config.fields.map(f=>{
			return {
				input : jsexpr.expr(f.input),
				output : jsexpr.assign(f.output)
			}
		});

		if(this.config.file) {
			let path = Path.resolve(this.config.$path,this.config.file);
			let file = await fs.readFile(path,'utf-8');
			try {
				let json = JSON.parse(file);
				extend(this.map,json);
			}catch(err) {
				return callback(err);
			}
		}
		callback();
	}

	start(callback) {
		callback();
	}

	process(entry,callback) {
		this.fields.forEach(f=>{
			let val = f.input(entry);
			let trans = this.map[val] || this.map["*"] || val;
			f.output(entry,trans);
		});
		callback(null,entry);
	}
}

module.exports = TranslateProcessor;