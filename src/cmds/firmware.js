const RyderSerial = require('ryderserial-proto');
const fs = require('fs').promises;
const fetch = require('node-fetch');
const path = require('path');
const {spawn} = require('child_process');

const firmware_dn = 'https://ryder-proto-v2.ryder.id/pioneer';

const homedir = require('os').homedir();

const ryder_firmware_directory = process.env.RYDER_FIRMWARE_DIRECTORY || path.join(homedir,'.ryder/proto-v2/firmware');
const versions_file = path.join(ryder_firmware_directory,'versions.json');


async function get_versions()
	{
	try
		{
		return JSON.parse(await fs.readFile(versions_file,'utf8'));
		}
	catch (error)
		{
		return false;
		}
	}

exports.command = 'firmware <action> [ver]';
exports.desc = 'Manage firmware versions.';
exports.builder = yargs =>
	yargs
		.positional('action',{type:'string',choices:['fetch','download','list','install','version']})
		.positional('ver',{describe:'',type:'string'})
		.check(argv =>
			{
			if((argv.action === 'install' || argv.action === 'download') && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(argv.ver))
				throw new Error('Version should be in the format X.Y.Z');
			return true
			});

exports.handler = async function(argv)
	{
	await fs.mkdir(ryder_firmware_directory,{recursive:true});
	
	switch (argv.action)
		{
		case 'fetch':
			console.log('Fetching latest firmware versions');
			var result = await fetch(firmware_dn+'/versions.json');
			var json = await result.json();
			console.log(Object.keys(json).join("\n"));
			await fs.writeFile(versions_file,JSON.stringify(json),'utf8');
			break;

		case 'list':
			var info = await argv._ryder_serial.send(RyderSerial.COMMAND_INFO);
			var current_version = `${info.charCodeAt(5)}.${info.charCodeAt(6)}.${info.charCodeAt(7)}`;
			var versions = await get_versions();
			if (!versions)
				console.log('No local firmware versions found, fetch first.');
			else
				console.log(Object.keys(versions).map(v => v === current_version ? v+' (currently installed)' : v).join("\n"));
			break;

		case 'download':
			var versions = await get_versions();
			if (!versions || !versions[argv.ver])
				{
				console.log('Unknown version. (Fetch?)');
				break;
				}
			var file = versions[argv.ver].file;
			console.log(`Downloading ${file}`);
			var result = await fetch(firmware_dn+'/'+file);
			await fs.writeFile(path.join(ryder_firmware_directory,file),await result.buffer());
			break;

		case 'install':
			var versions = await get_versions();
			if (!versions || !versions[argv.ver])
				{
				console.log('Unknown version. (Fetch?)');
				break;
				}
			var file_path = path.join(ryder_firmware_directory,versions[argv.ver].file);
			try
				{
				await fs.access(file_path);
				}
			catch (error)
				{
				if (error.code === 'ENOENT')
					{
					console.log(`Firmware file for version ${argv.ver} not found, download first.`);
					break;
					}
				}
			argv._ryder_serial.close();
			const esptool = spawn('esptool.py',['-p',argv['ryder-port'],'write_flash','0x010000',file_path]);
			esptool.on('error',error =>
				{
				if (error.code === 'ENOENT')
					console.log('esptool.py not found in PATH. Is it installed? (pip install esptool)');
				});
			esptool.stdout.on('data',message => console.log(message.toString()));
			esptool.stderr.on('data',message => console.error(message.toString()));
			break;
		}

	argv._ryder_serial.close();
	}
