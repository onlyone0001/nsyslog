const
	Processor = require("./"),
	moment = require('moment'),
	jsexpr = require("jsexpr");

class DateformatProcessor extends Processor {
	constructor(id) {
		super(id);
	}

	configure(config, callback) {
		this.field = jsexpr.expr(config.field || "${timestamp}");
		this.format = config.format || 'YYYY-MM-DD HH:mm:ss';
		this.output = jsexpr.assign(config.output || "date");
		callback();
	}

	process(entry,callback) {
		let ts = moment(this.field(entry));
		let res = ts.format(this.format);
		this.output(entry,res);
		callback(null,entry);
	}
}

module.exports = DateformatProcessor;