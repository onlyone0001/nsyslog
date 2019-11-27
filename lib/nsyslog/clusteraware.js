const
	logger = require("../logger"),
	extend = require("extend"),
	EventEmiter = require("events"),
	Cluster = require("../cluster"),
	{MODULE_TYPES,PROC_MODE} = require("../constants");

const CMD = { subscribe : 'subscribe', unsubscribe : 'unsubscribe'};

class ClusterAware extends EventEmiter {
	constructor(cfg,channel) {
		super();

		this.channel = channel;

		/** @property {Config} config Configuration file */
		this.config = cfg;

		/**
		 * @property {object} modules Contains all the components that runs this instance
		 * @property {object} modules.inputs Map of < string, {@link Input} > values
		 * @property {object} modules.processors Map of < string, {@link Processor} > values
		 * @property {object} modules.transporters Map of < string, {@link Transporter} > values
		 */
		this.modules = extend({inputs : {},	processors : {}, transporters : {}},cfg.modules);
		this.subscribers = new Map();
		this.subhdl = (type,id,mode,entry)=>process.send({module:channel,type,id,mode,entry});

		this.initialize();
	}

	/**
	 * Initialize the nsyslog instance.
	 * @private
	 */
	initialize() {
		let subhdl = this.subhdl;
		if(Cluster.isMaster) {
			Cluster.on(this.channel,(child,module,msg)=>{
				let key = `${msg.type}@${msg.id}@${msg.mode}`;
				let list = this.subscribers.get(key);
				if(list) {
					for (let cb of list)
						cb(msg.type,msg.id,msg.mode,msg.entry);
				}
			});
		}
		else {
			Cluster.on(this.channel,(process,module,msg)=>{
				try {
					if(msg.cmd==CMD.subscribe) {
						this.subscribe(msg.type,msg.id,msg.mode,subhdl);
					}
					else if(msg.cmd==CMD.unsubscribe) {
						this.unsubscribe(msg.type,msg.id,msg.mode,subhdl);
					}
				}catch(err){
					logger.error(err);
				}
			});
		}
	}

	/**
	 * Subscribe to components
	 *
	 * @param {Constants.MODULE_TYPES} type Component type
	 * @param {string} id Component ID
	 * @param {Constants.PROC_MODE} mode Process mode
	 * @param {function} handler listener handler
	 */
	subscribe(type,id,mode,handler) {
		let key = `${type}@${id}@${mode}`;
		if(!this.subscribers.has(key)) {
			this.subscribers.set(key,new Set());
		}
		this.subscribers.get(key).add(handler);

		let mod = this.modules[type][id];
		if(!mod) {
			throw new error(`Component of type "${type}" with ID "${args.id}" doesn't exist`);
		}

		if(type!=MODULE_TYPES.inputs)
			mod.streams.forEach(str=>str.subscribe(mode,handler));
		else
			this.inputStream.subscribe(id,handler);

		// Subscribe to child processes
		if(Cluster.isMaster) {
			Cluster.broadcast(this.channel,{cmd:CMD.subscribe,type,id,mode});
		}
	}

	/**
	 * Unsubscribe to components
	 *
	 * @param {Constants.MODULE_TYPES} type Component type
	 * @param {string} id Component ID
	 * @param {Constants.PROC_MODE} mode Process mode
	 * @param {function} handler listener handler
	 */
	unsubscribe(type,id,mode,handler) {
		let key = `${type}@${id}@${mode}`;
		if(!this.subscribers.has(key)) {
			this.subscribers.set(key,new Set());
		}
		this.subscribers.get(key).delete(handler);

		let mod = this.modules[type][id];
		if(!mod) {
			throw new error(`Component of type "${type}" with ID "${args.id}" doesn't exist`);
		}

		if(type!='inputs')
			mod.streams.forEach(str=>str.unsubscribe(mode,handler));
		else
			this.inputStream.unsubscribe(id,handler);

		// Unsubscribe to child processes
		if(Cluster.isMaster) {
			Cluster.broadcast(this.channel,{cmd:CMD.unsubscribe,type,id,mode});
		}
	}
}

module.exports = ClusterAware;