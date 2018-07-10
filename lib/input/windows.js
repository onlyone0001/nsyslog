const
	logger = require('../logger'),
	Input = require('./'),
	spawn = require("child_process").spawn,
	watermark = require("../watermark"),
	Queue = require('../queue'),
	xml = require('xml2js').parseString;

const MODE = {
	offset : "offset",
	watermark : "watermark"
}

const OFFSET = {
	end : "end",
	begin : "begin",
	start : "start"
}

class WindowsInput extends Input {
	constructor(id) {
		super(id);
	}

	async configure(config,callback) {
		config = config || {};
		this.channel = config.channel || "Application";
		this.readmode = MODE[config.readmode] || MODE.offset;
		this.offset = MODE[config.offset] || MODE.end;
		this.batchsize = parseInt(config.batchsize) || 1000;
		this.queue = new Queue();
		this.wm = await watermark.get(this.id);
		this.reading = null;
		callback();
	}

	get mode() {
		return Input.MODE.pull;
	}

	fetch() {
		if(this.reading) return this.reading;

		this.wm[this.channel] = this.wm[this.channel] || {channel:this.channel, ts:'1970-01-01T00:00:00.000000000Z'}

		let wm = this.wm[this.channel];
		let args = [
			"qe", wm.channel,
			"/f:XML",
			`/c:${this.batchsize}`,
			`/q:Event[System[TimeCreated[@SystemTime>='${wm.ts}']]]`
		];

		this.reading = new Promise((ok,rej)=>{
			let child = spawn('wevtutil',args);
			let buffer = "";

			child.stdout.on('data', async (data) => {
				buffer += `${data}`;
				let lines = buffer.split("</Event>\r");
				let last = lines[lines.length-1].trim();
				if(!last.endsWith('</EventData>')) buffer = lines.pop();
				else buffer = "";
				lines = lines.map(l=>`${l}</Event>`);

				let jslines = await Promise.all(
					lines.map(l=>new Promise((ok,rej)=>{
						xml(l,(err,json)=>err?ok({err}):ok(json));
					}))
				);

				jslines.filter(j=>j!=null).forEach(json=>{
					if(!json.err) {
						let newTs = json.Event.System[0].TimeCreated[0].$.SystemTime;
						if(wm.ts<newTs) wm.ts = newTs;
					}
					this.queue.push(json);
				});
			});

			child.on('error', rej);
			child.on('close', code => {
				if(code!=0) rej(`child process exited with code ${code}`);
				else ok();
			});
		}).then(()=>{
			this.reading = false;
			return watermark.save(this.wm);
		}).catch(err=>{
			logger.error(err);
			this.reading = false;
			return watermark.save(this.wm);
		});

		return this.reading;
	}

	async next(callback) {
		let read = false;
		while(!read) {
			try {
				let item = await this.queue.pop(1000);
				if(item.err)
					callback(item.err);
				else
					callback(null,{channel: this.channel, originalMessage: item.Event});

				read = true;
			}catch(err) {
				this.fetch();
			}
		}
	}

	async start(callback) {
		try {
			this.fetch();
			callback();
		}catch(err) {
			callback(err);
		}
	}

	stop(callback) {
		callback();
	}

	pause(callback) {
		callback();
	}

	resume(callback) {
		callback();
	}
}

module.exports = WindowsInput;