const
	logger = require("./logger"),
	extend = require("extend"),
	EventEmiter = require("events"),
	FileQueue = require("fileq"),
	AsyncStream = require("promise-stream-queue"),
	Config = require("./config"),
	QueueStream = require("./stream/queuestream"),
	AwaitStream = require("./stream/awaitstream"),
	InputWrapper = require("./input/wrapper"),
	Duplex = require("stream").Duplex,
	Transform = require("stream").Transform,
	Writable = require('stream').Writable;
	Transporters = Config.Transporters,
	Processors = Config.Processors,
	Factory = require("./factory"),
	StatsDB = require("./stats");

const tstats = [
	{path:"/sec/30", time:1000*30, options:{step:100,ops:["count"]}},
	{path:"/sec/60", time:1000*60, options:{step:1000,ops:["count"]}},
	{path:"/min/5", time:1000*60*6, options:{step:5000,ops:["count"]}},
	{path:"/min/15", time:1000*60*15, options:{step:10000,ops:["count"]}},
	{path:"/min/30", time:1000*60*30, options:{step:10000,ops:["count"]}},
	{path:"/min/60", time:1000*60*60, options:{step:10000,ops:["count"]}},
]

class NSyslog extends EventEmiter {
	constructor(cfg) {
		super();

		this.config = cfg;
		this.modules = {inputs : {},	processors : {},	transporters : {}};

		// Stream for the fileq file buffer
		this.queueStream = new QueueStream(FileQueue.from('servers',{path:"db",truncate:true}));
		this.queueStream.on("error",(err)=>{
			logger.error(err);
		});
	}

	async start() {
		try {
			await this.startProcessorStream();
			this.startTransportStream();
			this.startFlowStream();
			await this.startModules();
			this.startInputs();
		}catch(err) {
			logger.error(err);
			process.exit(1);
		}
	}

	async startProcessorStream() {
		let self = this;
		let	cfg = this.config;
		let procs = this.modules.processors;

		let handle = function(flow,processor) {
			return function(entry) {
				entry.flow = entry.flow || {};
				entry.flow[flow.id] = entry.flow[flow.id] || [];
				entry.flow[flow.id].push(this.instance.id);
				self.emit('processor',flow,processor,entry);
			}.bind(processor);
		}

		cfg.flows.forEach(flow=>{
			var to = Processors.Init(), from = to;
			flow.processors.
				map(proc=>Factory.transform(proc,flow)).
				forEach(p=>{
					p.on('data',handle(flow,p));
					to = to.pipe(p);
				});
			to.pipe(Processors.End());
			flow.pstream = {start:from,end:to};
		});
	}

	startTransportStream() {
		let	cfg = this.config;

		function walk(trs,flow) {
			if(trs.transport) {
				return Factory.writer(trs,flow);
			}
			else if(trs.mode=="serial") {
				var from = stream = Transporters.Null();
				trs.list.forEach(tr=>stream = stream.pipe(walk(tr,flow)));
				stream.pipe(Transporters.End());
				return from;
			}
			else if(trs.mode=="parallel") {
				var stream = Transporters.Null();
				trs.list.forEach(tr=>stream.pipe(walk(tr,flow)).pipe(Transporters.End()));
				return stream;
			}
			else {
				throw new Error(`Invalid transporter ${trs.id}`);
			}
		}

		cfg.flows.forEach(flow=>{
			var trs = flow.transporters;
			flow.tstream = walk(trs,flow);
		});
	}

	async startModules() {
		let
			modules = this.config.modules,
			trs = modules.transporters,
			prs = modules.processors;

		function start(m) {
			return new Promise((ok,rej)=>{
				m.start((err)=>{if(err) rej(err); else ok();});
			});
		}

		try {
			let ptrs = Object.keys(trs).map(id=>start(trs[id]));
			let pprs = Object.keys(prs).map(id=>start(prs[id]));
			await Promise.all([].concat(ptrs).concat(pprs));
			logger.info("All modules started successfuly");
		}catch(err) {
			logger.error("Error starting modules");
			throw err;
		}
	}

	startFlowStream() {
		let
			queueStream = this.queueStream,
			cfg = this.config,
			strconf = extend(true,{buffer:100},cfg.config.stream),
			seq = 0;

		// Active flows
		var flows = cfg.flows.filter(f=>!f.disabled);

		// For each flow, create a queue stream and pipe to processors stream,
		// then, pipe processors stream to transporters stream
		flows.forEach((f,i)=>{
			var fileq = FileQueue.from(f.id,{path:`./db/flows/${f.id}`,truncate:true});
			var wstr = new QueueStream(fileq,{highWaterMark:strconf.buffer});
			f.id = f.id || `Flow_${i}`;
			f.stream = wstr;
			f.stream.pipe(f.pstream.start);
			f.pstream.end.pipe(f.tstream);
		});

		// Collect input entries, filter "from" and "when" attributes, and
		// push them to the flow stream
		var flowStream = new Transform({
			objectMode:true, highWaterMark:strconf.buffer,
			transform(entry, encoding, callback) {
				entry.seq = seq++;
				let aflows = flows.filter(f=>f.from(entry));
				entry.flows = aflows.map(f=>f.id);
				aflows.
					filter(flow=>flow.when(entry)).
					forEach(flow=>flow.stream.write(entry));
				callback();
			}
		});

		// Instrument the stream
		queueStream.pipe(flowStream);
	}

	startInputs() {
		let
			queueStream = this.queueStream,
			cfg = this.config;

		for(var i in cfg.modules.inputs) {
			var input = new InputWrapper(cfg.modules.inputs[i]);
			input.start((err,entry)=>queueStream.write(entry));
		}
	}
}

module.exports = NSyslog;