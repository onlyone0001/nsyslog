const
	colors = require('colors'),
	colorize = require('json-colorizer'),
	Stats = require('../stats'),
	cluster = require('../cluster'),
	stats = Stats.fetch('main');

function cj(json) {return colorize(json,{pretty:true})};
const task = {start:[],callback:[]};
const MODULE = 'nsyslog-cli';
const CMD = {
	subscribe : "subscribe",
	unsubscribe : "unsubscribe",
	emit : "emit",
};

// Child process CLI
if(!cluster.isMaster) {
	function init(vorpal, instance) {}
	module.exports = init;
}

// Master process CLI
else {
	function init(vorpal, instance)  {
		vorpal.
		  command('input <id>').
			option('-o, --out', 'Shows output entries <default>').
			description('Prints output entries for Input Components').
			autocomplete(()=>Object.keys(instance.modules.inputs)).
			action(function(args,cb){
				fnsubscribe('inputs',args,cb);
			});

		vorpal.
		  command('processor <id>').
			option('-i, --in', 'Shows input entries').
			option('-o, --out', 'Shows output entries <default>').
			option('-a, --ack', 'Shows acked entries').
			description('Prints input/acked/output entries for Processor Components').
			autocomplete(()=>Object.keys(instance.modules.processors)).
		  action(function(args,cb){
				fnsubscribe('processors',args,cb);
			});

		vorpal.
		  command('transporter <id>').
			option('-i, --in', 'Shows input entries').
			option('-o, --out', 'Shows output entries <default>').
			option('-a, --ack', 'Shows acked entries').
			description('Prints input/output for Transporter Components').
			autocomplete(()=>Object.keys(instance.modules.transporters)).
			action(function(args,cb){
				fnsubscribe('transporters',args,cb);
			});

		vorpal.
		  command('stats [interval]').
			description('Prints statistics. Interval: Optional, refresh seconds').
		  action(fnstats);

		vorpal.
		  command('config').
			description('Prints complete config file').
		  action(function(args,callback){
				this.log(cj(instance.config.$$raw));
				callback();
			});

		vorpal.
		  command('start').
			description('Starts flows').
		  action(async function(args,callback){
				await instance.start();
				task.start.forEach(cb=>cb(callback));
				task.start = [];
			});

		vorpal.
		  command('stop').
			description('Stop flows').
			action(async function(args,callback){
				await instance.stop();
				callback();
			});

		vorpal.
		  command('pause').
			description('Pause flows').
			action(async function(args,callback){
				await instance.pause();
				callback();
			});

		vorpal.
		  command('resume').
			description('Resume flows').
			action(async function(args,callback){
				await instance.resume();
				callback();
			});

		vorpal.on('keypress',(evt)=>{
			if((evt.e.value=='q'||evt.e.value=='Q') && (task.callback.length)) {
				vorpal.log('\n************* Cancelled *************\n\n');
				task.callback.forEach(cb=>cb());
				task.callback = [];
				task.start = [];
			}
		});

		function logentry(type,id,mode,entry) {
			vorpal.log(`${type} - ${id} - ${mode}:`.green, cj(entry));
		}

		function fnsubscribe(type,args,callback) {
			let mode =	args.options.in? 'input' :
									args.options.ack? 'ack' : 'output';

			try {
				instance.subscribe(type,args.id,mode,logentry);
				vorpal.log('\n********* Press Q to cancel *********\n\n');
				task.start.push(callback=>{fnsubscribe(type,args,callback);});
				task.callback.push(()=>{
					instance.unsubscribe(type,args.id,mode,logentry);
				});
			}catch(err) {
				vorpal.log(`Component of type "${type}" with ID "${args.id}" doesn't exist`);
			}

			callback();
		}

		function fnstats(args, callback) {
			let tival = parseInt(args.interval);

			if(isNaN(tival)) {
				vorpal.log('stats'.yellow,cj(stats.all()));
			}
			else {
				vorpal.log('\n********* Press Q to cancel *********\n\n');
				vorpal.log('stats'.yellow,cj(stats.all()));

				let ival = setInterval(()=>vorpal.log('stats'.yellow,cj(stats.all())),tival*1000);
				task.callback.push(()=>{clearInterval(ival);});
			}
			callback();
		}
	}

	module.exports = init;
}