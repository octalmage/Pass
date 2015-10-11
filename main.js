var gui = require("nw.gui");
var SimplePeer = require("simple-peer");
var win = gui.Window.get();

gui.Screen.Init();
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
	}, gotMedia, function() {});
});

win.show();
win.showDevTools();

function gotMedia(stream)
{
	var peer1 = new SimplePeer(
	{
		initiator: true,
		stream: stream
	});
	var peer2 = new SimplePeer();

	peer1.on('signal', function(data)
	{
        //TODO: Implement external signal system.
		//console.log(JSON.stringify(data));
		peer2.signal(data);
	});

	peer2.on('signal', function(data)
	{
		peer1.signal(data);
	});

	peer2.on('stream', function(stream)
	{
		// got remote video stream, now let's show it in a video tag.
		var video = document.querySelector('video');
		video.src = window.URL.createObjectURL(stream);
		video.play();
	});
}