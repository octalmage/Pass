/*
 ____
|  _ \ __ _ ___ ___ 
| |_) / _` / __/ __|
|  __/ (_| \__ \__ \
|_|   \__,_|___/___/
By: Jason Stallings
URL: http://github.com/octalmage/pass
*/

var gui = require("nw.gui");
var SimplePeer = require("simple-peer");
var os = require("os");
var request = require("request");

var win = gui.Window.get();

//Only display when video is playing.
win.width = 0;
win.height= 0;

var sender = 0;
var init = null;

var app, io, hostname, ip, pingTimer, socket, peer;

var app_version = gui.App.manifest.version;

//win.showDevTools();
process.on("exit", cleanup);
process.on("SIGINT", cleanup);

if (process.platform === "darwin")
{
	var nativeMenuBar = new gui.Menu(
	{
		type: "menubar"
	});
	nativeMenuBar.createMacBuiltin("Pass");
	win.menu = nativeMenuBar;
}

//Create tray icon.
var tray = new gui.Tray(
{
	icon: "tray.png",
	iconsAreTemplates: false
});

//Give it a menu.
var menu = new gui.Menu();
menu.append(new gui.MenuItem(
{
	label: "Pass"
}));
menu.append(new gui.MenuItem(
{
	type: "separator"
}));
menu.append(new gui.MenuItem(
{
	label: "v" + app_version
}));

menu.append(new gui.MenuItem(
{
	type: "separator"
}));

menu.append(new gui.MenuItem(
{
	label: "Exit",
	click: function()
	{
		gui.App.quit();
	},
}));
tray.menu = menu;

//Hotkey Stuff
var option = {
	key: "Ctrl+Alt+P",
	active: function()
	{
		sender = 1;
		sendWindow();
	},
	failed: function(msg)
	{
		console.log(msg);
	}
};

var shortcut = new gui.Shortcut(option);

gui.App.registerGlobalHotKey(shortcut);

//Get ready for incomming connections.
startPinging();
startSocketServer();

//App start.
$(document).on("ready", function()
{
	$(".startButton").on("click", function()
	{
		type = $(this).attr("data-type");

		if (type === "send")
		{
			sender = 1;
			switchPage("send");

		}
		else
		{
			//switchPage("receive");

			startPinging();
			startSocketServer();
		}
	});

	$("#sendButton").on("click", function()
	{
		sendWindow();
	});

});

/*
 ____               _                
|  _ \ ___  ___ ___(_)_   _____ _ __ 
| |_) / _ \/ __/ _ \ \ \ / / _ \ '__|
|  _ <  __/ (_|  __/ |\ V /  __/ |   
|_| \_\___|\___\___|_| \_/ \___|_|   
									
*/

/**
 * Get the nessesary information and schedule ping to run every minute.
 */
function startPinging()
{
	ip = getIP();
	hostname = os.hostname();
	pingTimer = setInterval(ping, 60000);
	ping();
}

/**
 * Ping the zeroconf server to let it know we're open for receiving windows.
 */
function ping()
{
	var url = "http://zerohero.app.octalmage.com/add/pass/" + hostname + "/" + ip;

	request(url, function(error, response, body)
	{
		if (!error && response.statusCode == 200)
		{
			console.log(body);
		}
	});
}

/**
 * Starts a socket.io and web server for incomming connections from the sender.
 */
function startSocketServer()
{
	app = require("http").createServer(function(req, res) {});
	io = require("socket.io")(app);

	app.listen(8890);

	io.on('connection', function(rsocket)
	{
		var incommingHost;
		console.log("Sender connected.");

		peer = new SimplePeer();
		
		rsocket.on('request', function(data)
		{
			incommingHost = data;
		});

		rsocket.on('signal', function(data)
		{
			peer.signal(data);
		});

		peer.on('signal', function(data)
		{
			rsocket.emit("signal", data);
		});

		peer.on('stream', function(stream)
		{
			requestDialog(incommingHost, stream);
		});
		
		//Sender has stopped sending.
		peer.on('close', function()
		{
			peer.destroy();
			app.close();
			io.close();
			win.hide();
		});
	});
}

/**
 * Dialog to accept incomming window request. 
 * @param  {string} host   The hostname of the sending computer.
 * @param  {MediaStream} stream The stream of the incomming window.
 */
function requestDialog(host, stream)
{
	var dialog = gui.Window.open('request-dialog.html',
	{
		width: 400,
		height: 200,
		toolbar: false
	});
	
	dialog.on("loaded", function() 
	{
		dialog.window.$("#host").text(host);
		
		dialog.window.$("#acceptButton").on("click", function()
		{
			dialog.close();
			win.show();
			//got remote video stream, now let's show it in a video tag.
			var video = document.querySelector('video');
			video.src = window.URL.createObjectURL(stream);
			video.play();
			video.addEventListener('playing', resizeWindow, false);
		});
		
		dialog.window.$("#declineButton").on("click", function()
		{
			dialog.close();
			peer.destroy();
		});
	});
}

/**
 * Resize the cloned window to the video size.
 */
function resizeWindow()
{
	var video = document.querySelector('video');

	win.width = video.videoWidth;
	win.height = video.videoHeight;

	setTimeout(resizeWindow, 1000);

	//video.removeEventListener('playing', getVideoSize, false);
}

/*
 ____                 _           
/ ___|  ___ _ __   __| | ___ _ __ 
\___ \ / _ \ '_ \ / _` |/ _ \ '__|
 ___) |  __/ | | | (_| |  __/ |   
|____/ \___|_| |_|\__,_|\___|_|   
								 
*/

/**
 * Open a dialog to select a window, and get a stream.
 */
function sendWindow()
{
	if (!init)
	{
		init = 1;
		gui.Screen.Init();
	}
	
	gui.Screen.chooseDesktopMedia(["window"], function(streamId)
	{
		var vid_constraint = {
			mandatory:
			{
				chromeMediaSource: 'desktop',
				chromeMediaSourceId: streamId,
				maxWidth: 1920,
				maxHeight: 1080
			},
			optional: []
		};
		navigator.webkitGetUserMedia(
		{
			audio: false,
			video: vid_constraint
		}, pickDialog, function() 
		{
			//User selected cancel.
			win.hide();
		});
	});
	
	win.show();
}

/**
 * Callback for getUserMedia, it routes the stream to the correct receiver.
 * @param  {MediaStream} stream The stream of the selected window.
 */
function sendMedia(stream)
{
	getReceivers(function(ip)
	{
		connectToSocketServer(ip, stream);
	});
}

/**
 * Hits our zeroconf server and returns an IP address.
 * @param  {Function} callback Function to call after request returns.
 * @return {string}            IP of the local server.
 */
function getReceivers(callback)
{
	var url = "http://zerohero.app.octalmage.com/list/pass";

	request(url, function(error, response, body)
	{
		if (!error && response.statusCode == 200)
		{
			var receivers = JSON.parse(body);
			
			var ip = getIP();
			
			//Remove local host from array.
			for (var x in receivers)
			{
				if (receivers[x].ip === ip)
				{
					receivers.splice(x, 1);
				}
			}
			
			callback(receivers);
		}
	});
}

/**
 * Connect to the local receiver, and send it the stream!
 * @param  {string} ip     IP address of the receiver.
 * @param  {MediaStream} stream The stream of the selected window.
 */
function connectToSocketServer(ip, stream)
{
	//Use socket.io for signal data.
	socket = require("socket.io-client")("http://" + ip + ":8890");

	socket.on("connect", function()
	{
		console.log("Connected to receiver.");
		
		//Send our hostname for the dialog.
		socket.emit("request", os.hostname());
		
		//Start our peer to peer connection.
		peer = new SimplePeer(
		{
			initiator: true,
			stream: stream
		});

		//Send the signal to the receiver. 
		peer.on('signal', function(data)
		{
			socket.emit("signal", data);
		});
		
		//Receiver has stopped viewing.
		//TODO: Remove this if it isn't working.
		peer.on('close', function()
		{
			console.log("Peer disconnected.");
			peer.destroy();
			peer = null;
			socket.close();
			socket = null;
			win.hide();
		});
	});

	//When we receive the signal from socket.io, pass it to peer.
	socket.on("signal", function(data)
	{
		peer.signal(data);
	});
	
	socket.on("close", function()
	{
		console.log("Socket disconnected.");
		
		peer.destroy();
		socket.close();
		win.hide();
	});
}

/**
 * Dialog to pick the host to send the window stream to.
 * @param  {MediaStream} stream Stream from getUserMedia.
 */
function pickDialog(stream)
{
	getReceivers(openDialog);
	
	function openDialog(hosts)
	{
		var dialog = gui.Window.open('pick-dialog.html',
		{
			width: 400,
			height: 200,
			toolbar: false
		});
		
		dialog.on("loaded", function() 
		{
			var radioTemplate = '<input type="radio" name="host" value="{{ip}}">{{host}}<br>';
			for (var x in hosts)
			{
				var thisRadio = radioTemplate.replace("{{ip}}", hosts[x].ip).replace("{{host}}", hosts[x].name);
				dialog.window.$("#list").append(thisRadio);
			}
			
			dialog.window.$("#sendButton").on("click", function()
			{
				var selectedHost = dialog.window.$("input[name=host]:checked").val();
				dialog.close();
				
				//Send stream to selected host.
				connectToSocketServer(selectedHost, stream);
			});
			
			dialog.window.$("#cancelButton").on("click", function()
			{
				win.hide();
				dialog.close();
			});
		});
	}
}

/*
 _   _ _   _ _ _ _         
| | | | |_(_) (_) |_ _   _ 
| | | | __| | | | __| | | |
| |_| | |_| | | | |_| |_| |
 \___/ \__|_|_|_|\__|\__, |
                     |___/ 
*/

/**
 * Shows the current page, and hides the others.
 * @param  {string} page Page name.
 */
function switchPage(page)
{
	$(".page").hide();

	$("#" + page + "Page").show();
}

/**
 * Get local IP.
 * TODO: Make sure this is cross platform.
 * @return {string} IP Address.
 */
function getIP()
{
	var networkInterfaces = os.networkInterfaces();
	var ip = networkInterfaces.en0[1].address;
	return ip;
}

/**
 * Close all servers and exit the app.
 */
function cleanup()
{
	console.log("cleanup");
	peer.destroy();

	if (sender)
	{
		socket.close();
	}
	else
	{
		app.close();
		io.close();
	}

	gui.App.quit();
}