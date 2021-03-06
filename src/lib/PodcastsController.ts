import OfflineStorageHandler, { OfflineStorageHandlerImplementation, Podcast, Episode, RequireId} from './OfflineStorageHandler';
import PodcastindexOrgClient, { PodcastIndexOrgClientImplementation, Episode as PodcastIndexOrgEpisode } from './PodcastindexOrgClient';

export type PodcastView = RequireId<Podcast>;

type PodcastToAdd = {
	feedUrl: string,
	title?: string,
	description?: string,
	imageUrl?: string,
	subscribed: boolean
	podcastIndexOrgId?: number
}

export type EpisodeView = Episode;
export type EpisodeWithPodcastView = Episode & {
	podcast: PodcastView
}

export default interface PodcastsController {
	addPodcast(podcast: PodcastToAdd): Promise<void>;
	addPodcasts(podcasts: PodcastToAdd[]): Promise<void[]>;
	deletePodcastById(podcastId: number): Promise<void>;
	getPodcasts(): Promise<Array<PodcastView>>;
	getPodcast(feedUrl: string): Promise<PodcastView | undefined>;
	getPodcastById(id: number): Promise<PodcastView | undefined>;
	updatePodcasts(): Promise<void>;
	getEpisodes(feedUrl: string): Promise<EpisodeView[]>;
	getAllEpisodes(count: number, asOfPubDate: Date): Promise<EpisodeWithPodcastView[]>;
	getEpisodesInProgress(): Promise<EpisodeWithPodcastView[]>;
	updateEpisodeCurrentTime(episodeId: number, currentTime: number): void;
}

export class PodcastsControllerImplementation implements PodcastsController {
	offlineStorageHandler: OfflineStorageHandler = new OfflineStorageHandlerImplementation();
	podcastIndexOrgClient: PodcastindexOrgClient = new PodcastIndexOrgClientImplementation();

	async addPodcast(podcast: PodcastToAdd): Promise<void> {
		let podcastId = await this.offlineStorageHandler.addPodcast({
			...podcast,
			status: 'new'
		});

		const podcastAtPodcastindexOrg = await this.podcastIndexOrgClient.getPodcastByFeedUrl(podcast.feedUrl);

		await this.offlineStorageHandler.updatePodcast({
			id: podcastId,
			title: podcastAtPodcastindexOrg.title,
			description: podcastAtPodcastindexOrg.description,
			link: podcastAtPodcastindexOrg.link,
			imageUrl: podcastAtPodcastindexOrg.imageUrl,
			podcastIndexOrgId: podcastAtPodcastindexOrg.id,
			...(podcastAtPodcastindexOrg.value && {value: [podcastAtPodcastindexOrg.value]})
		});

		let episodes = await this.podcastIndexOrgClient.getEpisodes(podcast.feedUrl);

		await this.offlineStorageHandler.putEpisodes(episodes.map((episode) => {
			return {
				...this.mapPodcastIndexOrgEpisodeToStorage(episode),
				podcastId: podcastId,
			};
		}));

		await this.offlineStorageHandler.updatePodcast({
			id: podcastId,
			status: 'processed',
			podcastIndexOrgLastEpisodeFetch: new Date()
		});
	}

	async addPodcasts(podcasts: PodcastToAdd[]): Promise<void[]> {
		return Promise.all(podcasts.map((podcast) => this.addPodcast(podcast)));
	}

	async deletePodcastById(podcastId: number): Promise<void> {
		return this.offlineStorageHandler.deletePodcastById(podcastId);
	}

	private mapPodcastIndexOrgEpisodeToStorage(podcastIndexOrgEpisode: PodcastIndexOrgEpisode): Omit<Episode, 'podcastId'> {
		return {
			title: podcastIndexOrgEpisode.title,
			link: podcastIndexOrgEpisode.link,
			description: podcastIndexOrgEpisode.description,
			pubDate: new Date(podcastIndexOrgEpisode.pubDate),
			imageUrl: podcastIndexOrgEpisode.imageUrl,
			enclosure: podcastIndexOrgEpisode.enclosure && {
				url: podcastIndexOrgEpisode.enclosure.url,
				length: podcastIndexOrgEpisode.enclosure.length,
				type: podcastIndexOrgEpisode.enclosure.type
			},
			guid: podcastIndexOrgEpisode.guid,
			podcastIndexOrgId: podcastIndexOrgEpisode.id,
		};
	}

	async getPodcasts(): Promise<Array<PodcastView>> {
		return (await this.offlineStorageHandler.getPodcasts()).map((storedPodcast) => {
			return {
				...storedPodcast,
				id: storedPodcast.id as number,
				title: storedPodcast.title ? storedPodcast.title : storedPodcast.feedUrl
			}
		});
	}

	async getPodcast(feedUrl: string): Promise<PodcastView | undefined> {
		return this.offlineStorageHandler.getPodcast(feedUrl);
	}

	async getPodcastById(id: number): Promise<PodcastView | undefined> {
		return this.offlineStorageHandler.getPodcastById(id);
	}

	async updatePodcasts(): Promise<void> {
		let podcasts = await this.offlineStorageHandler.getPodcasts();

		for(let key in podcasts) {
			let podcast = podcasts[key];
			let episodes: PodcastIndexOrgEpisode[];

			try {
				episodes = await this.podcastIndexOrgClient.getEpisodes(podcast.feedUrl);
			}
			catch(e) {
				continue;
			}

			let storedEpisodes = await this.getEpisodes(podcast.feedUrl);

			episodes.forEach((episode) => {
				let matchIndex = storedEpisodes.findIndex((storedEpisode) => {
					return storedEpisode.podcastIndexOrgId === episode.id;
				});

				if(matchIndex >= 0) {
					storedEpisodes[matchIndex] = {
						...storedEpisodes[matchIndex],
						...this.mapPodcastIndexOrgEpisodeToStorage(episode),
					}
				}
				else {
					storedEpisodes.push({
						...this.mapPodcastIndexOrgEpisodeToStorage(episode),
						podcastId: podcast.id as number
					})
				}
			});

			this.offlineStorageHandler.putEpisodes(storedEpisodes);
		}
	}

	async getEpisodes(feedUrl: string): Promise<EpisodeView[]> {
		let podcast = await this.offlineStorageHandler.getPodcast(feedUrl);

		return podcast ? this.offlineStorageHandler.getEpisodes(podcast.id) : [];
	}

	async getAllEpisodes(count: number, asOfPubDate: Date): Promise<EpisodeWithPodcastView[]> {
		let podcasts = await this.offlineStorageHandler.getPodcasts();
		let episodes = await this.offlineStorageHandler.getAllEpisodes(count, asOfPubDate);

		return PodcastsControllerImplementation.addPodcastToEpisodes(episodes, podcasts);
	}

	async getEpisodesInProgress(): Promise<EpisodeWithPodcastView[]> {
		let podcasts = await this.offlineStorageHandler.getPodcasts();
		let episodesInProgress = await this.offlineStorageHandler.getEpisodesInProgress();

		return PodcastsControllerImplementation.addPodcastToEpisodes(episodesInProgress, podcasts);
	}

	updateEpisodeCurrentTime(episodeId: number, position: number) {
		this.offlineStorageHandler.updateEpisode({
			id: episodeId,
			position: position,
			lastTimeListened: new Date()
		});
	}

	private static addPodcastToEpisodes(episodes: RequireId<Episode>[], podcasts: PodcastView[]): EpisodeWithPodcastView[] {
		return episodes.map((episode) => {
			let podcast = podcasts.find((p) => p.id === episode.podcastId) as PodcastView;

			return {
				...episode,
				podcast: podcast
			}
		});
	}
}