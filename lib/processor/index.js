class Processor  {
	constructor(id) {
		this.id = id;
	}

	configure(cfg, callback) {
		if(callback) callback();
	}

	start(callback) {
		if(callback) callback();
	}

	stop(callback) {
		if(callback) callback();		
	}

	process(entry,callback) {
		callback(null,entry);
	}
}

module.exports = Processor;