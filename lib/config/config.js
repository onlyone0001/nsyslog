const
	Q = require("q"),
	fs = require("fs"),
	path = require("path"),
	extend = require("extend"),
	Transporters = require("./transporters.js"),
	Processors = require("./processors.js"),
	expression = require("../expression.js");

const SERVERS = {
	null : require("../server/null.js"),
	udp : require("../server/udp.js"),
	tcp : require("../server/tcp.js")
};

// Flatten an array of nested arrays of nested arrays...
const flatten = arr => arr.reduce(
  (a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []
);

/**
 * Reads the main configuration file and retrieve
 * the instances of servers, filters, processors
 * and transformers
 */
function read(file,callback) {
	// Since a config file can have nested includes
	// that must be merged into the main file, the
	// process is recursive. We create a first
	// virtual configuration, wich includes the main
	// file
	var json = {include:[file]};

	// Includes and merges all the configuration
	// files
	imports("",json).then(json=>{
		// Gets the raw json before replacing keys with
		// actual instances of components
		raw = JSON.parse(JSON.stringify(json));
		processServers(json); 		// Get servers
		processFilters(json);			// Get Filters
		processFlows(json);				// Get Flows
		callback(null,json,raw);
	},err=>{
		callback(err,json);
	});
}

/**
 * Imports recursively nested configuration files, and registers
 * custom components. The final result is the merged configuration
 */
function imports(file,json) {
	var q = Q.defer();
	var basepath = path.dirname(file);

	// for every include in the current file
	all = Q.all((json.include || []).map(f=>{
		var q = Q.defer();
		var ifile = basepath + "/" + f;
		fs.readFile(ifile,"utf-8",(err,data)=>{
			if(err) q.reject(err);
			else {
				// Register components
				var njson = JSON.parse(data);
				registerComponents(basepath,njson,(err,res)=>{
					if(err) q.reject(err);
					else {
						// Nested includes
						imports(ifile,njson).then(q.resolve,q.reject);
					}
				});
			}
		});
		return q.promise;
	})).then(res=>{
		// Merge parent file with nested includes
		res.forEach(njson=>extend(true,json,njson));
		q.resolve(json);
	},err=>{
		q.reject(err);
	});

	return q.promise;
}

// Simple function to unify flow attributes as arrays
function asArray(v) {
	if(typeof(v)=="string") return [v];
	else return v;
}

/**
 * Register custom components
 */
function registerComponents(basepath,json,callback) {
	var all = json.register || [];
	var voidfn = (basepath,cmp,callback)=>{
		callback(`Invalid component type ${cmp.type}`);
	};

	// For every declared component
	return Q.all(all.map(cmp=>{
		var q = Q.defer(), register = voidfn;
		if(cmp.type=="processor") register = Processors.register;
		else if(cmp.type=="transporter") register = Transporters.register;

		register(basepath,cmp,(err,cmp)=>{
			if(err) q.reject(err);
			else q.resolve(cmp);
		});
		return q.promise;
	})).then(
		res=>{callback(null,res)},
		err=>{callback(err,null)}
	);
}

function processServers(json) {
	for(var i in json.servers) {
		var def = json.servers[i];
		var cls = SERVERS[def.type] || SERVERS.null;
		var instance = new cls();
		instance.configure(def.config);
		json.servers[i] = instance;
	}
}

function processFilters(json) {
	json.filters["*"] = "true";

	for(var i in json.filters) {
		var val = json.filters[i];
		json.filters[i] = expression.fn(val);
		json.filters[i].id = val;
	}
}

function processFlows(json) {
	const
		MODE = "parallel",
		voidfn = function() {return false;},
		voidtr = ()=>Transporters.instance("NULL");
		voidpr = ()=>Processors.instance("NULL");
		nof = function(f){console.warn(`Filter '${f}' doesn't exist`); return voidfn;},
		nofg = function(f){console.warn(`Filter Group '${f}' doesn't exist`); return voidfn;},
		nop = function(f){console.warn(`Processor '${f}' doesn't exist`); return voidpr;},
		nopg = function(f){console.warn(`Processor Group '${f}' doesn't exist`); return voidpr;},
		notr = function(tr){console.warn(`Transporter '${tr}' doesn't exist`); return voidtr();},
		notrg = function(tr){console.warn(`Transporter Group '${tr}' doesn't exist`); return voidtr();};

	function filterTree(json,filters) {
		var fns = asArray(filters).map(f=>{
			if(f.startsWith("$")) {
				var group = json.filterGroups[f.substring(1)];
				return group? filterTree(json,group) : nofg(f);
			}
			else {
				return json.filters[f]||nof(f);
			}
		});
		return function(entry) {
			return fns.some(fn=>fn(entry));
		}
	}

	function processorTree(json,procs) {
		var fns = asArray(procs).map(p=>{
			if(p.startsWith("$")) {
				var group = json.processorGroups[p.substring(1)];
				return group? processorTree(json,group) : nopg(p);
			}
			else {
				var def = json.processors[p];
				return def? Processors.instance(p,def.type,def.sticky,def.config) : nop(p);
			}
		});
		return flatten(fns);
	}

	function transTree(json,transporters,mode) {
		var trs = asArray(transporters).map(tr=>{
			if(tr.startsWith("$")) {
				var group = json.transporterGroups[tr.substring(1)];
				return group? transTree(json,group.transporters,group.mode||MODE) : notrg(tr);
			}
			else {
				var def = json.transporters[tr];
				return def? Transporters.instance(tr,def.type,def.config) : notr(tr);
			}
		});
		return {list:trs,mode:mode||MODE};
	}

	json.flows.forEach((flow,i)=>{
		flow.parse = flow.parse===undefined? true : flow.parse;

		// From Filters
		flow.from = flow.from || "*";
		flow.from = filterTree(json,flow.from);

		// When Filters
		flow.when = flow.when || "*";
		flow.when = filterTree(json,flow.when);

		// Transporters
		flow.transporters = flow.transporters || [];
		flow.transporters = transTree(json,flow.transporters,flow.mode||MODE);

		// Processors
		flow.processors = flow.processors || [];
		flow.processors = processorTree(json,flow.processors);

		flow.id = flow.id || `flow_${i}`;
	});
}

module.exports = {
	read : read,
	Transporters : Transporters,
	Processors : Processors
}